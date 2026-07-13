# Architecture

`shv` is a Dockerized TypeScript modular monolith. One Express process serves JSON APIs, static frontend assets, video streams, thumbnails, extension packages, and a bounded-concurrency download queue.

The product contract lives in [docs/product.md](product.md). This document is the source of truth for current implementation structure, module boundaries, storage ownership, and runtime contracts. Put product scope in [docs/product.md](product.md), durable rationale in [docs/decisions.md](decisions.md), and local workflow notes in [docs/development.md](development.md).

## Runtime Paths

- `/data/library`: user-visible category folders and final media files.
- `/data/app`: SQLite database, thumbnails, browser profile data, manual-selection screenshots, diagnostics, and downloader cookies.
- `/work`: temporary download and media-processing scratch space.

The container entrypoint owns the persistent-volume compatibility boundary. Before each start, it idempotently
reassigns legacy root-owned files within all three mounted roots, verifies that the runtime paths and SQLite file are
writable, and then starts both Tini and Node as the unprivileged `node` user. The scan stays on each mounted filesystem,
does not follow symlinks, and leaves entries owned by other non-root users unchanged. Running the scan every time also
covers rollback/re-upgrade and restored-backup cases. Storage that rejects `chown` or remains unwritable fails before
application initialization with an explicit mount-permission error.

Every file operation that touches user media goes through path-containment helpers in `src/server/utils/fileSafety.ts`.

`/work` and `/data/library` may live on different Docker-mounted filesystems. Moving finished media between them must handle `EXDEV` by copying and removing the source rather than assuming `rename` can cross that boundary.

Video streaming headers must be ASCII-safe. User-facing filenames can contain Unicode, so `/media/:id` uses an ASCII `filename` fallback plus RFC 5987 `filename*` instead of writing raw Unicode into `Content-Disposition`.

## Backend Modules

- `config`: environment-derived runtime paths, public app origin, extension profile, and network binding.
- `storage`: SQLite opening, migrations, and row mapping.
- `categories`: flat category folder ownership.
- `media-library`: media records plus rename, move, delete, thumbnail, and path ownership.
- `jobs`: persistent queue state and the single active queue runner.
- `browser-analyzer`: Playwright Chromium page loading, network capture, HTML media extraction, and screenshot diagnostics.
- `browser-live`: older live-browser diagnostic/manual-selection support.
- `candidate-detection`: source-agnostic URL, content-type, and HTML classification.
- `source-extractors`: explicit platform extractors such as YouTube via `yt-dlp`.
- `download-engine`: direct HTTP download plus HLS/DASH handling and browser-request downloads.
- `media-processing`: ffprobe metadata, browser compatibility decision, ffmpeg remux/transcode path, and thumbnail generation.
- `api`: Express routes, extension package generation, candidate ingestion, cookie upload, and video Range streaming.

Within `jobs`, `JobService` owns durable state transitions and run claims, `QueueRunner` owns orchestration,
`jobProgressMonitor` owns progress persistence and stall detection, `subtitleDownload` owns subtitle transfer/rewrite,
and `jobArtifacts` owns job-scoped cleanup. Keep protocol-specific transfer details out of the runner orchestration.

## Frontend

The React UI is category-first. It contains:

- category navigation;
- add-video dialog with existing-category selection or get-or-create category entry;
- media library cards;
- queue panel for pending, current, failed, canceled, and manual-selection jobs;
- browser-extension-assisted manual candidate selection;
- video playback dialog;
- media rename, move, and delete actions.

Frontend ownership is split by responsibility under `src/web/src`: `components` owns shared shell/navigation and
accessible primitives, `features` owns library, queue, and dialog flows, `lib` owns API/extension boundaries, and
`styles` mirrors those surfaces with a small token layer. TanStack Query owns remote category, media, runtime-config,
and queue state, including queue polling and targeted invalidation. Radix primitives own modal/dialog and dropdown-menu
keyboard/focus behavior while project CSS remains the visual source of truth.

Desktop keeps persistent category navigation. At tablet/mobile widths the same actions move into a focus-trapped drawer
so category volume cannot push the current library or queue below a long navigation block.

There is intentionally no login, nested categories, duplicate detection, global search, or public-internet deployment assumption.

## Library Contracts

Category creation is idempotent by sanitized display name. Calling the create endpoint with an existing category name returns the existing category instead of creating `Name 2`.

Category rename updates only the display name and keeps the existing folder name stable, so saved media paths do not move.

Category and media filenames are sanitized before touching the filesystem. Folder and media path collisions are resolved with stable numeric suffixes through the file-safety helpers rather than overwriting existing files.

Category deletion is cascading after explicit UI confirmation: saved media rows, video files in the category folder, thumbnails, and hidden completed job rows for that category are removed with it. Categories with visible queue jobs still return a conflict so active or problem queue work is not orphaned.

Media item dimensions are stored from the final `ffprobe` run on the normalized output file. Do not use candidate `resolution` for saved library cards because it describes a discovered source, not necessarily the file after remuxing, transcoding, rotation metadata, or other processing.

Thumbnails are owned under the app data root. Media category folders should contain user-visible saved videos, not app metadata.

## Storage Model

SQLite uses explicit migrations under `src/server/storage/migrations.ts`. Core tables are:

- `categories`: display name, stable folder name, and creation time.
- `media_items`: category, title, filename, relative media path, thumbnail path, final media metadata, source URL, and timestamps.
- `download_jobs`: source URL, category, status, selected candidate, title hint, error details, progress, and lifecycle timestamps.
- `media_candidates`: job-owned candidate URL, kind, content type, manifest type, resolution, bitrate, duration, size, confidence, captured headers, subtitle tracks, and discovery time.
- `settings`: key/value app settings.

The filesystem owns media bytes; SQLite owns the index, queue, candidate, and metadata state.

Captured candidate and subtitle request headers are internal download context. Candidate API responses preserve the candidate shape but strip those headers at the Express DTO boundary so queue and candidate-list reads cannot disclose cookies, authorization values, or custom tokens.

## Queue Contracts

`QueueRunner` runs up to two active jobs by default (configure `MAX_CONCURRENT_JOBS` to change the limit). Each job follows this pipeline independently:

```text
analyze -> download -> process -> library insert
```

Runnable work is claimed with one SQLite `UPDATE ... RETURNING` operation. The claim assigns a unique run ID, and every
active transition and persisted progress update compares that ID together with the expected status. A stale callback or
manual-selection request therefore cannot requeue or complete a newer attempt, and separate runner processes cannot claim
the same pending row.

On server startup, interrupted `analyzing`, `downloading`, `processing`, and `adding_subtitles` jobs are reset to `pending` so a Docker restart cannot leave a queue item permanently stuck in an active state.
Before processing writes into the library it durably reserves the job's final relative path. Recovery preserves that
reservation, so a restarted attempt reuses the same job-owned path instead of leaving an orphan and selecting a suffixed
filename. The final `media_items` insert and `download_jobs` completion update share one transaction, and
`media_items.job_id` is unique; repeating finalization after an uncertain commit returns the existing media item.

The queue UI shows one honest current-stage indicator rather than a synthetic whole-pipeline percentage. A stage is determinate only when the backend has a trustworthy denominator, such as response size, HLS/DASH duration, or media duration. Otherwise the native progress indicator stays indeterminate while the stage label explains the active work.

Download callbacks distinguish confirmed activity from calculable progress. Every received media chunk or advancing ffmpeg `out_time` refreshes the in-memory stall watchdog, including direct responses without `Content-Length`, large HLS segments, browser-impersonated downloads without a total size, and DASH inputs without a known duration. Activity-only heartbeats do not write SQLite. Determinate stage progress is persisted at bounded intervals or meaningful deltas, and guarded by the expected job status so late callbacks cannot overwrite a later phase or cancellation.
Selected-subtitle transfers use the same activity watchdog and stream response bodies instead of waiting on one opaque
buffer operation. Download progress logs are emitted only at bounded milestones, including 95%, 99%, and completion,
so chunk frequency cannot create a log storm near the end of a large transfer.

Runnable, active, problem, and canceled jobs are returned by `/api/queue`; only `completed` jobs leave the active queue UI automatically.

Automatic analysis chooses a candidate only when the submitted source URL's direct probe classifies it, or its redirect target, as a confident media source. Confident candidates discovered later through HTML inspection, Playwright network capture, or extension capture still move the job to `needs_manual_selection` so the user explicitly confirms which page source to download.

Manual selection supports choosing a candidate or replacing the job source URL via `/api/jobs/:id/replace-source`. Retrying or replacing the source of an active job aborts and waits for its current pipeline to settle before resetting it to `pending`, so stale async work cannot complete the old source or overlap the new run.

When the selected candidate has supported subtitle tracks (`webvtt`, `srt`, `ass`, or subtitle HLS), manual selection
pauses at `needs_subtitle_selection`. The queue UI then calls `/api/jobs/:id/select-subtitle-track` with either one
track URL or `null`. The backend stores that choice by setting exactly one candidate subtitle track `isSelected: true`,
or all supported tracks `isSelected: false` when the user chooses no subtitles.

Queue-stage rendering must tolerate unknown future job statuses from the API. A stale or older web bundle can otherwise
receive a newly introduced status, produce no stage object, and crash the queue screen while reading progress labels.

Canceling a running job goes through `QueueRunner.cancel()`, not only a database status update, so the current browser analysis, direct download, ffmpeg copy/remux, transcode, or thumbnail process receives an `AbortSignal`.

Deleting a job goes through `DELETE /api/jobs/:id`, aborts any active work, removes job-owned scratch files, screenshots, thumbnails, live-browser profile data, candidates, and the job row.

Progress callbacks must check that the job still exists and is still running before writing new state, otherwise a canceled or deleted job can be accidentally revived by late async work.
Failures are stored with phase-specific codes for analysis, download, processing, subtitle, and finalization work; genuine
connection interruptions use a separate recoverable network code. The UI maps those codes to the next useful action and
keeps the raw exception under technical details.

## Downloader Contracts

Generic sites use the built-in web/media pipeline:

- URL extension and response headers;
- HTML `<video>`, `<source>`, and media links;
- Playwright-captured network requests;
- extension-captured active playback requests;
- HLS manifests;
- DASH manifests;
- ffmpeg/ffprobe as low-level media tools.

Direct downloads should resume from the existing output size when the server accepts byte ranges. If a resume request is not accepted, the downloader rewrites the output rather than appending incompatible bytes.

Every URL supplied to the downloader, including subtitle, HLS, and DASH URLs derived from manifests, must use HTTP(S). All Node, browser-impersonated, and ffmpeg media traffic passes through a loopback proxy that rejects loopback, link-local, private, multicast, and reserved targets. The proxy rejects a hostname when any DNS answer is unsafe and connects directly to an address from the validated DNS snapshot, preserving the original hostname for HTTP Host and TLS while preventing DNS-rebinding races. Node-managed downloads follow redirects manually and recompute captured headers for each target origin. Browser-impersonated inputs disable redirects. Each ffmpeg DASH input receives its own origin-locked proxy, so same-origin redirects remain usable but a redirect to another origin is rejected before ffmpeg can replay captured credentials. The HLS ffmpeg fallback uses a general validating proxy but receives no captured request headers because ffmpeg refetches a mutable manifest whose child origins can differ from the inspected snapshot.

DRM-protected streams are unsupported. Future work should mark them explicitly rather than attempting key extraction or circumvention.

Site-specific downloader engines are allowed only behind explicit extractors for known complex platforms. YouTube uses `yt-dlp` because `googlevideo` playback URLs can be bound to player/runtime details that are not replayable by the generic downloader.
`yt-dlp` may download separate video and audio streams before merging them. Its percentage is determinate only while a
single stream advances monotonically; when the reported percentage restarts for another stream, or post-processing
begins, the queue switches to an explicitly labeled indeterminate substage instead of holding a misleading 99% value.

Some DASH manifests expose video and audio as separate adaptation sets. The downloader must select both the best video representation and the best audio representation, then pass both inputs to ffmpeg with stream copy. Selecting only the video representation silently produces a saved file without sound.

Direct `browser-request` media candidates are intentionally downloaded with the browser-impersonated `curl_cffi` path instead of Node `fetch`. Some CDNs accept the same signed URL, cookies, referer, range, and sec-fetch headers from Chromium's media network stack but return HTTP 403 to Node/undici. Keep this as the single backend for direct `browser-request` media so failures have one debuggable request path.

Captured request headers are origin-bound. The downloader replays them only to the origin of the URL that supplied them; cross-origin HLS variants, segments, keys, init maps, DASH renditions, subtitle playlists, and subtitle segments receive no captured headers. When ffmpeg must own a complex HLS playlist, any cross-origin child resource removes captured headers from the whole ffmpeg input because ffmpeg accepts only one header set for that playlist.

DASH manifests are parsed as XML rather than scanned with regular expressions. Namespace-prefixed and self-closing representation elements are supported, comments are ignored, and escaped query separators such as `&amp;` are decoded before invoking ffmpeg.

The built-in DASH downloader currently supports representations with a direct `BaseURL` on the representation or its adaptation set. `SegmentTemplate` and `SegmentList` manifests are not expanded into segment downloads; representations without a playable `BaseURL` must be rejected instead of treating the manifest URL itself as media input.

HLS/DASH downloads write to an extensionless work file, so ffmpeg remux calls pass an explicit output muxer.

Plain, unencrypted HLS media playlists whose segments are ordinary `.ts` files are downloaded by the built-in segment downloader. This preserves browser-captured request headers and avoids ffmpeg HLS replay quirks with signed CDN playlists. Complex HLS playlists such as encrypted, byte-range, or fMP4/init-map streams stay on the ffmpeg fallback path.

HLS progress should come from media-playlist `#EXTINF` durations when every media segment has a finite positive duration.
If even one segment lacks a valid duration, the built-in downloader falls back to completed segment count and the ffmpeg
path remains indeterminate. DASH progress uses static MPD `mediaPresentationDuration`, a sole `Period@duration`, or
trusted candidate duration in that order. Dynamic, ambiguous, or duration-less manifests remain indeterminate while
structured ffmpeg progress still supplies activity heartbeats. Do not infer remote-download activity from arbitrary
stderr output.

For HLS segment reliability, keep the ffmpeg reconnect options enabled and keep HLS `http_persistent` disabled. Some signed segment CDNs can invalidate or truncate keepalive/TLS sessions mid-download, producing partial segments and corrupt audio packets.

Do not enable `reconnect_at_eof` for HLS fallback. VOD media playlists end normally at EOF, and treating that as a reconnect point can make ffmpeg loop instead of advancing through the playlist.

## Media Processing Contracts

Media normalization should prefer lossless container remuxing before transcoding. For example, DASH downloads can produce VP9 in a WebM/Matroska work file; if the video/audio codecs are already browser-compatible, `MediaProcessor` first tries `ffmpeg -c copy` into MP4 and falls back to full H.264/AAC transcode only if the remux is not viable.

When remuxing MPEG-TS HLS work files into MP4, reject copy-remux outputs whose duration inflates beyond a small tolerance or whose decoded video stream reports invalid timestamp ordering. Some copied streams can otherwise produce an MP4 with a plausible container duration but broken A/V sync.

If a rejected HLS remux failed because of timestamp or duration inflation, the fallback transcode must preserve the input timestamps with `-copyts -start_at_zero`. This avoids converting HLS timestamp discontinuities into a long audio tail.

Do not replace that with trimming flags such as `-shortest` or `-t`. The transcode should still decode the source; the fix is to preserve timestamp intent, not to clip the output after ffmpeg has already expanded discontinuities into extra duration.

Keep the post-transcode duration guard so a future ffmpeg behavior change fails the job instead of saving another inflated MP4.

Selected subtitles are downloaded in the explicit `adding_subtitles` phase after the media source has been normalized. `QueueRunner`
downloads only selected supported tracks. For plain subtitle files it preserves the captured request context; for subtitle
HLS playlists it downloads and concatenates the subtitle segments first. Current output uses a single chosen subtitle
track and burns it into the video with ffmpeg's `subtitles` filter. The saved MP4 should therefore show subtitles by
default and should not be expected to expose switchable subtitle streams in the app's HTML5 player. Subtitle download
and burn-in share that queue phase; burn-in percentage comes from structured ffmpeg timestamps
instead of leaving the preceding processing phase frozen near completion.

## Browser Analyzer And Extension Contracts

The Docker image installs Playwright-managed Chromium with `npx playwright install --with-deps chromium`. Do not point `CHROMIUM_EXECUTABLE_PATH` at Debian's system `chromium` unless that exact browser has been verified with the installed Playwright version.

Candidate detection only records server-downloadable URLs. Browser-local `blob:` URLs, explicit byte-range chunk URLs such as `?bytes=0-6402`, and generic `application/octet-stream` responses without a video-looking URL are intentionally ignored so the manual source picker does not offer sources the server cannot download as complete videos.

Manual source selection is extension-first. The older Playwright live-browser screenshot endpoints still exist as backend fallback and diagnostic tools, but they are not the target production UX. Avoid reintroducing screenshot polling in the frontend unless the extension approach is explicitly abandoned.

Detailed extension behavior, packaging, candidate capture, cookies, diagnostics, and profile ids live in [docs/browser-extension.md](browser-extension.md).

## Logging And Diagnostics

Queue downloads emit compact structured lines prefixed with `[shv]`. Useful events include `job-started`, `download-started`, `hls-manifest-selected`, `hls-segments-stitched`, `download-probed`, `download-progress`, `processing-started`, `subtitle-downloaded`, `processing-completed`, `job-completed`, `download-stalled`, and `job-failed`.

These logs intentionally keep candidate URLs to `host` and `path`, list only request header names, and omit cookies/query strings so production snippets can be shared for debugging without leaking signed media URLs.

`processing-completed` includes `processingStrategy` (`moved`, `remuxed`, or `transcoded`), `subtitleTrackCount`, and may include `remuxRejectionReason` when a copy-remux candidate was rejected and the processor fell back to transcoding.

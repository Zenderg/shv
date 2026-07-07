# shv Architecture

`shv` is a Dockerized TypeScript modular monolith. One Express process serves JSON APIs, static frontend assets, video streams, thumbnails, and a single-worker download queue.

## Runtime Paths

- `/data/library`: user-visible category folders and final media files.
- `/data/app`: SQLite database, thumbnails, browser profile data, manual-selection screenshots.
- `/work`: temporary download and media-processing scratch space.

Every file operation that touches user media goes through path containment helpers in `src/server/utils/fileSafety.ts`.
`/work` and `/data/library` may live on different Docker-mounted filesystems, so moving finished media between them must
handle `EXDEV` by copying and removing the source instead of assuming `rename` can cross that boundary.
Video streaming headers must be ASCII-safe. User-facing filenames can contain Unicode, so `/media/:id` uses an ASCII
`filename` fallback plus RFC 5987 `filename*` instead of writing raw Unicode into `Content-Disposition`.

## Backend Modules

- `config`: environment-derived runtime paths and network binding.
- `storage`: SQLite opening, migrations, and row mapping.
- `categories`: flat category folders under the library root.
- `media-library`: media records plus rename, move, delete, thumbnail and path ownership.
- `jobs`: persistent queue state and the single active queue runner.
- `browser-analyzer`: Playwright Chromium page loading, network capture, HTML media extraction, and manual-selection screenshots.
- `candidate-detection`: source-agnostic URL/content-type/HTML classification.
- `download-engine`: direct HTTP download plus HLS/DASH handoff to ffmpeg.
- `media-processing`: ffprobe metadata, browser compatibility decision, ffmpeg transcode/remux path, thumbnail generation.
- `api`: Express routes and video Range streaming.

## Frontend

The React UI is category-first. It contains:

- category navigation;
- add-video dialog with existing-category selection or get-or-create category entry;
- media library cards;
- queue panel for pending/current/problem jobs;
- browser-extension-assisted manual candidate selection;
- video playback dialog;
- media rename, move, and delete actions.

There is intentionally no login, nested categories, duplicate detection, global search, or public-internet deployment assumption.

Category creation is intentionally idempotent by sanitized display name. Calling the create endpoint with an existing category name returns the existing category instead of creating `Name 2`, so multiple videos can naturally land in one category.
Category rename updates only the display name and keeps the existing folder name stable, so saved media paths do not move.
Category deletion is cascading after explicit UI confirmation: saved media rows, video files in the category folder, thumbnails, and hidden completed job rows for that category are removed with it. Categories with visible queue jobs still return a conflict so active or problem queue work is not orphaned.

## Queue Progress

`QueueRunner` serializes active work: analyze -> download -> process -> library insert. On server startup, interrupted
`analyzing`, `downloading`, and `processing` jobs are reset to `pending` so a Docker restart cannot leave a queue item
permanently stuck in an active state.

The queue UI shows two progress bars per job: total job progress and progress within the current stage. Download progress
comes from the download engine; processing progress comes from ffmpeg transcode timestamps when transcoding is required.
Media normalization should prefer lossless container remuxing before transcoding. For example, DASH downloads can produce
VP9 in a WebM/Matroska work file; if the video/audio codecs are already browser-compatible, `MediaProcessor` first tries
`ffmpeg -c copy` into MP4 and falls back to full H.264/AAC transcode only if the remux is not viable.
Media item dimensions are stored from the final `ffprobe` run on the normalized output file. Do not use candidate
`resolution` for saved library cards because it describes a discovered source, not necessarily the file after remuxing,
transcoding, rotation metadata, or other processing.
Runnable, active, problem, and canceled jobs are returned by `/api/queue`; only `completed` jobs leave the active queue UI
automatically. Canceling a running job goes through `QueueRunner.cancel()`, not only a database status update, so the
current browser analysis, direct download, ffmpeg copy/remux, transcode, or thumbnail process receives an `AbortSignal`.
Canceling keeps the job visible as `canceled`; deleting a job goes through `DELETE /api/jobs/:id`, aborts any active work,
removes job-owned scratch files/screenshots/thumbnails/live-browser profile data, deletes candidates, and removes the job
row. Progress callbacks must check that the job still exists and is still running before writing new state, otherwise a
canceled or deleted job can be accidentally revived by late async work.

## Downloader Boundary

The project deliberately avoids site-specific downloader engines. General-purpose mechanisms are allowed:

- URL extension and response headers;
- HTML `<video>`, `<source>`, and media links;
- Playwright-captured network requests;
- HLS manifests;
- DASH manifests;
- ffmpeg/ffprobe as low-level media tools.

Some DASH manifests expose video and audio as separate adaptation sets. The downloader must select both the best video
representation and the best audio representation, then pass both inputs to ffmpeg with stream copy. Selecting only the
video representation silently produces a saved file without sound.

DRM-protected streams are unsupported. Future work should mark them explicitly rather than attempting key extraction or circumvention.

## Browser Analyzer Runtime Notes

The Docker image installs Playwright-managed Chromium with `npx playwright install --with-deps chromium`. Do not point
`CHROMIUM_EXECUTABLE_PATH` at Debian's system `chromium` unless that exact browser has been verified with the installed
Playwright version; a mismatched system Chromium can crash before page analysis starts.

Candidate detection only records server-downloadable URLs. Browser-local `blob:` URLs, explicit byte-range chunk URLs
such as `?bytes=0-6402`, and generic `application/octet-stream` responses without a video-looking URL are intentionally
ignored so the manual source picker does not offer sources the server cannot download as complete videos.
The browser extension also accepts extensionless request URLs that carry an explicit `mime=video/...` query hint. This
keeps active playback capture working on platforms that serve playable media from generic paths and may hide response
headers from ordinary extension observation.
Some Chromium media requests, especially from worker-backed players, can arrive in `webRequest` with `tabId = -1`.
After a URL is already classified as media, the extension may attach that request to an active source session whose
`sourceUrl`/`currentUrl` origin matches the request `initiator`; this keeps worker-mediated playback tied to the visible
tab without accepting unrelated background traffic.

Manual source selection is extension-first. `Choose source` checks for the local Chromium extension
`ncgeehcdlbbdgojleaoefhhdinmdhcaf` and verifies its protocol version. If the extension is missing or outdated, the app
shows an install/update dialog that downloads `/extension/shv-source-helper.zip` from the running app. If the
extension is ready, it opens the source URL in a normal Chromium browser tab and injects a live Sources sidebar directly
into that page through the extension content script. The extension deliberately does not depend on Chrome's native
`sidePanel` API or Yandex's `YandexSidePanel` feature flag. It captures source candidates from active playback, not from
every media-looking request on the page: the content script reports playback from one visible dominant `<video>`, and
the service worker accepts recent network candidates only during a short rolling active window. This keeps preloaded
recommendations, ad previews, and byte-range chunks out of the primary Sources list. Accepted candidates are posted to
`/api/jobs/:id/extension-candidates` and use the existing candidate merge/select pipeline. The content script is loaded
in all frames so embedded players can report playback; only the top frame handles the visible sidebar, the app bridge,
and source-selection messages. Some embedded players do not expose a usable DOM `<video>` to content scripts while still
streaming media requests; the top-frame sidebar provides Capture now as a manual fallback that opens the same active
capture window around current playback. Capture now should visibly enter a short Listening state; it does not synthesize
old requests, so an already-buffered player may need continued playback or seeking to emit a fresh media request during
that window. For network candidates, the extension stores a limited downloader header allowlist
from `webRequest.onBeforeSendHeaders` (`Referer`, `User-Agent`, `Origin`, `Accept*`, and `sec-ch-ua*`) because some signed
media hosts reject server-side retries without the browser request context. The service worker must snapshot those
headers synchronously in `onHeadersReceived` before async state reads; otherwise cleanup can remove the request-id entry
before the candidate is posted, leaving `headers_json` empty and causing signed hosts such as YouTube `googlevideo` to
return HTTP 403 during server download. On the explicit `Use source` action, the extension also collects cookies for the
source page and selected media URLs, posts only those cookies to the local backend, and attaches matching `Cookie`
headers to media candidates. DASH manifests are XML, so representation `BaseURL` values can contain escaped query separators
such as `&amp;`; the downloader decodes XML text before passing representation URLs to ffmpeg so signed media hosts see
the same query string the browser saw. HLS/DASH downloads write to an extensionless work file, so ffmpeg copy/remux calls
must pass an explicit output muxer instead of relying on the filename. Hover and keyboard focus in the Sources sidebar
should highlight the related area on the page only when the content script can match an exact DOM URL or find one dominant
visible player. Network-only candidates intentionally do not highlight small preview videos or recommendation tiles,
because those URLs usually cannot be traced back to a specific DOM attribute. After `Use source` succeeds, the extension
notifies and focuses the original app tab so the queue reflects the manual selection immediately.
The Sources sidebar receives frequent state-change notifications while playback diagnostics and network candidates update.
Keep candidate cards keyed by URL and update their text/button state in place; replacing the whole sources container can
remove a `Use source` button between pointer down and click, making the first click appear to do nothing.
Some YouTube `googlevideo` playback URLs include signature constraints that are not replayable outside the player media
pipeline, even when request headers are preserved. Do not make the extension download those files itself; extension
service-worker `fetch` is still a different request context and can return the same HTTP 403. QueueRunner therefore
checks the original `sourceUrl` before using manual candidates, and known YouTube page URLs go through the backend
`yt-dlp` source extractor. Generic extension/manual capture remains the path for ordinary direct, HLS, and DASH media
URLs.
If YouTube requires sign-in or bot confirmation, the extractor passes the configured Netscape-format cookies file to
`yt-dlp`. By default this is `/data/app/youtube-cookies.txt`, which is `./data/app/youtube-cookies.txt` in the Docker
Compose mount; set `YTDLP_COOKIES_FILE` only to point at a different mounted cookie file. The backend merges uploaded
cookies by domain/path/name so a later generic-site selection does not wipe previously saved YouTube cookies. Cookie
upload remains tied to the user's `Use source` action and does not export unrelated browser cookies.
The Docker image installs `yt-dlp[default]`, not plain `yt-dlp`, so the `yt-dlp-ejs` challenge solver scripts are present.
The YouTube extractor also passes `--js-runtimes node`; without both pieces, YouTube may expose only storyboard image
formats and `yt-dlp` will fail with `Requested format is not available`.
App-to-extension commands that create source tabs must not be retried over the content-script bridge after a runtime
message timeout, because the first command may still be opening and injecting into a slow page.
When capture is empty, the sidebar renders diagnostics from both the content script and service worker: DOM video counts,
dominant/active playback flags, media-like network observations, classifier hits, and session-mapping counters. Keep
those diagnostics available while triaging site-specific capture failures so future fixes can target the failing layer.

The older Playwright live-browser screenshot endpoints still exist as a backend fallback and diagnostic tool, but they
are not the target production UX for manual source selection. Avoid reintroducing screenshot polling in the frontend
unless the extension approach is explicitly abandoned.

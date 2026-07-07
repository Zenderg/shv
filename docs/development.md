# Development Notes

This project is designed to start through Docker Compose. Local commands are fine for tests, checks, scripts, and other tasks that are not application startup.

## Docker Compose

Start the application with:

```bash
docker compose up --build
```

Detached mode is useful for browser debugging:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

For the in-app Codex browser, `http://127.0.0.1:8080/` is usually the most reliable URL.

## Codex Sandbox Notes

- Docker Compose needs access to the Docker socket, so `docker compose up -d --build` and `docker compose ps` may need sandbox escalation.
- If sandboxed `curl` cannot reach port `8080` but `docker compose ps` shows `0.0.0.0:8080->8080/tcp`, retry the HTTP check with escalation before assuming the app is down.
- The in-app browser can open and evaluate the page even if `domSnapshot()` fails with `incrementalAriaSnapshot is not a function`; verify with page URL, title, or a small read-only `evaluate` instead.

## Local Checks

```bash
npm test
npm run typecheck
npm run build
```

## Local UI Seed Data

Use the dev seed command when the local library needs fake categories and media rows for UI work:

```bash
npm run dev:seed
npm run dev:seed -- --categories 20 --videos 500
```

The command appends data under the local Docker Compose mounts in `./data`. It creates `[dev] ` categories, `dev-seed://`
media records, tiny placeholder `.mp4` files, and a few tiny placeholder thumbnails. The `.mp4` files are intentionally
not playable videos; they exist to exercise library UI, file paths, card metadata, rename, move, and delete behavior
without running the downloader or ffmpeg pipeline.

Remove only generated dev seed data with:

```bash
npm run dev:seed:reset
```

Reset deletes media rows whose `source_url` starts with `dev-seed://`, removes their placeholder files and thumbnails,
and removes empty `[dev] ` categories. It leaves ordinary categories and non-seed media in place.

## README Showcase Data And Screenshots

Use the showcase seed when the local library should look polished for README screenshots:

```bash
npm run showcase:seed:reset
npm run showcase:seed
```

The showcase seed creates clean category names, realistic video titles, SVG thumbnails, and a few non-running queue jobs.
It is separate from stress-test dev data, and reset removes only rows and files created by the showcase workflow.

With the Docker Compose app running, refresh README screenshots with:

```bash
npm run showcase:screenshots
```

The screenshot command writes PNG files under `docs/assets` and defaults to `http://127.0.0.1:8080`. Override the target with
`SHV_SCREENSHOT_BASE_URL` when needed.

## Frontend UI Notes

Design the library UI touch-first. Phones and tablets are supported browsing surfaces, so primary actions must remain visible and usable without hover. Hover and focus states can add polish, but they must not be the only way to discover or use video, category, queue, or dialog actions.

## Downloader Boundary

Generic sites should continue to use the built-in web/media pipeline: HTTP probing, Playwright/extension network capture, HTML media extraction, HLS/DASH manifest handling, and ffmpeg/ffprobe.

Site-specific downloader engines are allowed only behind explicit extractors for known complex platforms. YouTube uses `yt-dlp` because `googlevideo` playback URLs can be bound to player/runtime details that are not replayable by the generic downloader.

Direct `browser-request` media candidates are intentionally downloaded with the browser-impersonated `curl_cffi` path instead
of Node `fetch`. Some CDNs accept the same signed URL, cookies, referer, range, and sec-fetch headers from Chromium's media
network stack but return HTTP 403 to Node/undici. Do not "fix" those failures by adding more headers to `fetch`; use the
dedicated browser-request path so that this class of source has one debuggable backend.

Do not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.

## Production Download Diagnostics

Queue downloads emit compact structured lines prefixed with `[shv]`. Useful events include `job-started`, `download-started`,
`hls-manifest-selected`, `hls-segments-stitched`, `download-probed`, `download-progress`, `processing-started`,
`processing-completed`, `job-completed`, `download-stalled`, and `job-failed`. These logs intentionally keep
candidate URLs to `host` and `path`, list only request header names, and omit cookies/query strings so production snippets can be
shared for debugging without leaking signed media URLs.

`processing-completed` includes `processingStrategy` (`moved`, `remuxed`, or `transcoded`) and may include
`remuxRejectionReason` when a copy-remux candidate was rejected and the processor fell back to transcoding.

`DOWNLOAD_STALL_TIMEOUT_MS` controls how long a download may sit without progress before the runner aborts that transfer and marks
the job failed. The default is 120000 milliseconds. Raise it for very slow sources; lower it when production should fail faster
than the UI polling loop can make obvious.

Set `PRESERVE_WORK_DIR=1` only during local/media diagnostics when the intermediate `WORK_ROOT/<jobId>/source.preserved`
file is needed for ffprobe or ffmpeg experiments. Do not enable it by default in production because preserved source files
can be large.

## HLS and DASH Notes

DASH manifests are XML, so representation URLs may contain escaped query separators such as `&amp;`; the downloader decodes those before invoking ffmpeg.

HLS/DASH downloads write to an extensionless work file, so ffmpeg remux calls pass an explicit output muxer.

Plain, unencrypted HLS media playlists whose segments are ordinary `.ts` files are downloaded by the built-in segment downloader.
This preserves browser-captured request headers and avoids ffmpeg HLS replay quirks with signed CDN playlists. Complex HLS playlists
such as encrypted, byte-range, or fMP4/init-map streams stay on the ffmpeg fallback path.

HLS progress should come from media-playlist `#EXTINF` durations when using the built-in segment downloader, or from ffmpeg's
structured `-progress` output when using the fallback path. Do not infer progress from stderr activity.

For HLS segment reliability, keep the ffmpeg reconnect options enabled and keep HLS `http_persistent` disabled; some signed segment CDNs can invalidate or truncate keepalive/TLS sessions mid-download, producing partial segments and corrupt audio packets.
Do not enable `reconnect_at_eof` for HLS fallback; VOD media playlists end normally at EOF, and treating that as a reconnect point can make ffmpeg loop instead of advancing through the playlist.

When remuxing MPEG-TS HLS work files into MP4, reject copy-remux outputs whose duration inflates beyond a small tolerance
or whose decoded video stream reports invalid timestamp ordering. Some copied streams can otherwise produce an MP4 with a
plausible container duration but broken A/V sync. Let the processor fall back to transcoding rather than accepting that file.

If a rejected HLS remux failed because of timestamp or duration inflation, the fallback transcode must preserve the input
timestamps with `-copyts -start_at_zero`. Some MPEG-TS HLS segments contain discontinuities even when the media playlist
duration is correct; ordinary ffmpeg timestamp normalization can expand those discontinuities into a long audio tail. This is
not the same as trimming with `-shortest` or `-t`: the transcode still decodes the source, but avoids converting HLS timestamp
offsets into extra output duration. Keep the post-transcode duration guard so a future ffmpeg behavior change fails the job
instead of saving another inflated MP4.

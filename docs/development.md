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

Do not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.

## Production Download Diagnostics

Queue downloads emit compact structured lines prefixed with `[shv]`. Useful events include `job-started`, `download-started`,
`download-progress`, `processing-started`, `job-completed`, `download-stalled`, and `job-failed`. These logs intentionally keep
candidate URLs to `host` and `path`, list only request header names, and omit cookies/query strings so production snippets can be
shared for debugging without leaking signed media URLs.

`DOWNLOAD_STALL_TIMEOUT_MS` controls how long a download may sit without progress before the runner aborts that transfer and marks
the job failed. The default is 120000 milliseconds. Raise it for very slow sources; lower it when production should fail faster
than the UI polling loop can make obvious.

## HLS and DASH Notes

DASH manifests are XML, so representation URLs may contain escaped query separators such as `&amp;`; the downloader decodes those before invoking ffmpeg.

HLS/DASH downloads write to an extensionless work file, so ffmpeg remux calls pass an explicit output muxer.

HLS/DASH downloads are delegated to ffmpeg because it already handles playlist traversal, segment fetching, and stream copy/remux without reimplementing media container rules in TypeScript. HLS progress should come from ffmpeg's structured `-progress` output and media-playlist `#EXTINF` durations, not from stderr activity.

For HLS segment reliability, keep the ffmpeg reconnect options enabled and keep HLS `http_persistent` disabled; some signed segment CDNs can invalidate or truncate keepalive/TLS sessions mid-download, producing partial segments and corrupt audio packets.

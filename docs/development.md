# Development Notes

This document is the source of truth for local development workflows, checks, seed data, sandbox notes, and repeatable maintenance commands. Put product behavior in [docs/product.md](product.md), implementation contracts in [docs/architecture.md](architecture.md), and release procedure in [docs/releases.md](releases.md).

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

The repository `docker-compose.yml` sets `SOURCE_EXTENSION_PROFILE=dev` so local development expects the development extension id and package. Production deployments use the production extension profile by default.

## Codex Sandbox Notes

- Docker Compose needs access to the Docker socket, so `docker compose up -d --build` and `docker compose ps` may need sandbox escalation.
- If sandboxed `curl` cannot reach port `8080` but `docker compose ps` shows `0.0.0.0:8080->8080/tcp`, retry the HTTP check with escalation before assuming the app is down.
- The in-app browser can open and evaluate the page even if `domSnapshot()` fails with `incrementalAriaSnapshot is not a function`; verify with page URL, title, or a small read-only `evaluate` instead.
- GitHub issue reads work through the GitHub connector, but issue creation may return `403 Resource not accessible by integration`. In that case, use `gh issue create --repo Zenderg/shv` with sandbox escalation for network access.

## Local Checks

Run focused checks while developing:

```bash
npm test
npm run typecheck
npm run build
```

`npm run build` builds the extension content script, web app, and server.

After extension runtime changes, `npm run build:extension` should leave `extension/chrome-source-helper/content-script.js` syntactically valid. A focused check is:

```bash
node --check extension/chrome-source-helper/content-script.js
```

## Local UI Seed Data

Use the dev seed command when the local library needs fake categories and media rows for UI stress work:

```bash
npm run dev:seed
npm run dev:seed -- --categories 20 --videos 500
```

The command appends data under the local Docker Compose mounts in `./data`. It creates `[dev] ` categories, `dev-seed://` media records, tiny placeholder `.mp4` files, and a few tiny placeholder thumbnails.

The `.mp4` files are intentionally not playable videos; they exist to exercise library UI, file paths, card metadata, rename, move, and delete behavior without running the downloader or ffmpeg pipeline.

The generated data should keep UI edge cases available: long category names, long titles, unicode text, missing thumbnails, mixed durations, mixed dimensions, mixed containers/codecs, and uneven category sizes.

Remove only generated dev seed data with:

```bash
npm run dev:seed:reset
```

Reset deletes media rows whose `source_url` starts with `dev-seed://`, removes their placeholder files and thumbnails, and removes empty `[dev] ` categories. It leaves ordinary categories and non-seed media in place.

## README Showcase Data And Screenshots

Use the showcase seed when the local library should look polished for README screenshots:

```bash
npm run showcase:seed:reset
npm run showcase:seed
```

The showcase seed creates clean category names, realistic video titles, SVG thumbnails, and a few non-running queue jobs. It is separate from stress-test dev data, and reset removes only rows and files created by the showcase workflow.

With the Docker Compose app running, refresh README screenshots with:

```bash
npm run showcase:screenshots
```

The screenshot command writes PNG files under `docs/assets` and defaults to `http://127.0.0.1:8080`. Override the target with `SHV_SCREENSHOT_BASE_URL` when needed.

## Extension Preview

For sidebar layout work that does not need real browser-extension APIs, run:

```bash
npm run preview:extension
```

This starts a local Vite-only visual harness at `http://127.0.0.1:5174`. It mounts the real `SourceSidebar` component in Shadow DOM with mocked states for collapsed, empty, listening, candidate, selected, and long-URL views.

Use the full Docker Compose app plus a real unpacked extension when validating `Use source`, extension messaging, network capture, cookies, or server integration.

## Manual Source And Subtitle Validation

Use the full Docker Compose app and a real unpacked extension when validating source selection with subtitles. The
repeatable flow is:

1. Rebuild and start the app:

```bash
docker compose up -d --build
```

2. Reload the unpacked extension in the browser if extension runtime files or version changed.
3. In the source page, start playback, select a source with `Use source`, then choose a subtitle track or `No subtitles`
   in the main queue UI.
4. Watch the job state:

```bash
curl -s http://127.0.0.1:8080/api/queue
docker compose logs --tail 120
```

Expected evidence for a selected subtitle track:

- `/api/queue` shows the selected candidate with exactly one supported `subtitleTracks` entry marked `isSelected: true`;
- logs include `subtitle-downloaded` with the chosen label, language, and format;
- logs include `processing-completed` with `subtitleTrackCount: 1`;
- the saved library file is a new filename when a previous file already existed, for example `Title-2.mp4`.

Verify the saved file with `ffprobe` and a representative frame:

```bash
ffprobe -hide_banner -v error -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height -of default=nw=1 '/path/to/saved.mp4'
ffmpeg -hide_banner -loglevel error -ss 00:00:27 -i '/path/to/saved.mp4' -frames:v 1 -y /tmp/shv-subtitle-check.png
```

For burned subtitles, the final proof is the extracted frame: the subtitle text should be visible in the image pixels.
Do not expect a separate switchable subtitle stream in the default HTML5 player.

## Frontend UI Notes

Design the library UI touch-first. Phones and tablets are supported browsing surfaces, so primary actions must remain visible and usable without hover. Hover and focus states can add polish, but they must not be the only way to discover or use video, category, queue, or dialog actions.

## Environment And Diagnostics

`DOWNLOAD_STALL_TIMEOUT_MS` controls how long a download may sit without progress before the runner aborts that transfer and marks the job failed. The default is 120000 milliseconds. Raise it for very slow sources; lower it when production should fail faster than the UI polling loop can make obvious.

Set `PRESERVE_WORK_DIR=1` only during local/media diagnostics when the intermediate `WORK_ROOT/<jobId>/source.preserved` file is needed for ffprobe or ffmpeg experiments. Do not enable it by default in production because preserved source files can be large.

Set `PUBLIC_APP_ORIGIN` when a reverse proxy hides the public scheme or host from Node and the extension package must be generated for the browser-visible origin.

Set `YTDLP_COOKIES_FILE` only when the container should use a different mounted Netscape-format cookie file than `/data/app/youtube-cookies.txt`.

## Documentation Hygiene

Keep durable documentation in the owning file listed by [docs/product.md](product.md#documentation-ownership). Rationale, rejected alternatives, and useful historical context belong in [docs/decisions.md](decisions.md).

Do not add completed implementation plans, temporary specs, or agent handoff notes under `docs/` as if they were product documentation. If a plan discovers a durable constraint, fold that constraint into `docs/product.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/browser-extension.md`, `docs/development.md`, or `docs/releases.md`.

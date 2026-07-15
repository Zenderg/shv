# Development Notes

This document is the source of truth for local development workflows, checks, seed data, sandbox notes, and repeatable maintenance commands. Put product behavior in [docs/product.md](product.md), implementation contracts in [docs/architecture.md](architecture.md), and release procedure in [docs/releases.md](releases.md).

This project is designed to start through Docker Compose. Local commands are fine for tests, checks, scripts, and other tasks that are not application startup.

## Runtime

Use Node.js 24.18.0 or newer for local commands. The server imports `node:sqlite`, and the Docker image plus release workflow pin Node 24.18.0 LTS so the SQLite runtime API is consistent between local checks, CI release builds, and the production container. Typechecking uses the native Go-based TypeScript 7 CLI from `@typescript/native`; the `typescript` dependency exposes the official TypeScript 6 compatibility API for Svelte tooling, and `svelte-check` covers the `.svelte` sources. The image is based on Debian 13 (Trixie), and the release workflow runs tests, typechecking, builds, and an unprivileged Chromium smoke launch in a Docker validation stage derived from that production toolchain.

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

The repository `docker-compose.yml` defaults to `SOURCE_EXTENSION_PROFILE=prod`, so routine Compose use does not expose
development extension diagnostics. To debug the extension locally, opt in explicitly:

```bash
SOURCE_EXTENSION_PROFILE=dev docker compose up -d --build
```

That profile expects the development extension id and package. Stop the dev-profile container before returning to the
default production profile.

The Compose service runs with a read-only root filesystem. Persistent application state belongs in the mounted `./data`
folders; `/tmp` is an in-memory temporary filesystem for Chromium and other transient runtime files. The container
entrypoint may start as root only to perform the persistent-volume ownership migration, then it launches Tini and the
application as the unprivileged `node` user.

## Codex Sandbox Notes

- Docker Compose needs access to the Docker socket, so `docker compose up -d --build` and `docker compose ps` may need sandbox escalation.
- If sandboxed `curl` cannot reach port `8080` but `docker compose ps` shows `0.0.0.0:8080->8080/tcp`, retry the HTTP check with escalation before assuming the app is down.
- The in-app browser can open and evaluate the page even if `domSnapshot()` fails with `incrementalAriaSnapshot is not a function`; verify with page URL, title, or a small read-only `evaluate` instead.
- Sandboxed `gh` network operations may require escalation. Follow [docs/agent-github-workflows.md](agent-github-workflows.md) for connector preference, permission-error fallback, issue selection, and pull request publication rules.

## Local Checks

Install the locked dependencies before the first local check in a fresh clone or worktree:

```bash
npm ci
```

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
docker compose stop
npm run dev:seed -- --categories 1 --videos 1000
docker compose start
```

Omit the flags for the default seed, or use `--categories 20 --videos 500` when category navigation is the stress target.

The seed utility opens the bind-mounted SQLite database directly from the host. Keep the Compose service stopped for
both seed and reset commands; concurrent host and container SQLite connections are not a supported workflow on the
Docker bind mount and can leave the running container connection unusable until restart.

The command appends data under the local Docker Compose mounts in `./data`. It creates `[dev] ` categories, `dev-seed://` media records, tiny placeholder `.mp4` files, and a few tiny placeholder thumbnails.

The `.mp4` files are intentionally not playable videos; they exist to exercise library UI, file paths, card metadata, rename, move, and delete behavior without running the downloader or ffmpeg pipeline.

The generated data should keep UI edge cases available: long category names, long titles, unicode text, missing thumbnails, mixed durations, mixed dimensions, mixed containers/codecs, uneven category sizes, unlabeled videos, multi-label videos, Unicode labels, and long label chips.

When changing the library label flow, verify on desktop and a phone-width viewport that chips filter without disappearing
during loading, the filtered/full totals stay distinct, horizontal chip overflow remains usable, label entry accepts both
suggestions and new values, rename-to-existing explains the merge, removal confirms that videos remain, and moving a
labeled video updates both category summaries.

Remove only generated dev seed data with:

```bash
docker compose stop
npm run dev:seed:reset
docker compose start
```

Reset deletes media rows whose `source_url` starts with `dev-seed://`, removes their placeholder files and thumbnails, and removes empty `[dev] ` categories. It leaves ordinary categories and non-seed media in place.

For a repeatable large-category performance check, seed one category with 1000 videos, open that category in the Docker
Compose app, and verify all of these before resetting the seed:

- the heading reports the full 1000-item total while the first API response contains no more than 60 items;
- scrolling near the end fetches another cursor page without clearing the already loaded cards;
- the number of mounted `.videoCard` elements remains viewport-sized rather than approaching 1000;
- switching categories returns the workspace to the top;
- `/assets/*` responses are compressed and immutable, while a missing chunk and an unknown `/api/*` route return 404.

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

The screenshot command writes PNG files under `docs/assets`, filters API responses to showcase-owned media and jobs so local user data cannot leak into documentation, and defaults to `http://127.0.0.1:8080`. Override the target with `SHV_SCREENSHOT_BASE_URL` when needed.

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

`DOWNLOAD_STALL_TIMEOUT_MS` controls how long source analysis, a download, downloaded-file inspection, media normalization, a cross-filesystem media move, or subtitle burning may sit without confirmed activity before the runner aborts it and marks the job failed. The default is 120000 milliseconds. Activity includes received media chunks, copied file chunks, and advancing structured ffmpeg timestamps even when a percentage cannot be calculated. Raise the timeout for sources or processing workloads that can legitimately stop reporting activity for long periods; lower it when production should fail faster than the UI polling loop can make obvious.

Set `PRESERVE_WORK_DIR=1` only during local/media diagnostics when the intermediate `WORK_ROOT/<jobId>/source.preserved` file is needed for ffprobe or ffmpeg experiments. Do not enable it by default in production because preserved source files can be large.

Set `PUBLIC_APP_ORIGIN` when a reverse proxy hides the public scheme or host from Node and the extension package must be generated for the browser-visible origin.

Set `YTDLP_COOKIES_FILE` only when the container should use a different mounted Netscape-format cookie file than `/data/app/youtube-cookies.txt`.

## Documentation Hygiene

Keep durable documentation in the owning file listed by [docs/product.md](product.md#documentation-ownership). Rationale, rejected alternatives, and useful historical context belong in [docs/decisions.md](decisions.md).

Do not add completed implementation plans, temporary specs, or agent handoff notes under `docs/` as if they were product documentation. If a plan discovers a durable constraint, fold that constraint into `docs/product.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/browser-extension.md`, `docs/development.md`, or `docs/releases.md`.

# shv

Self-hosted local video library and downloader for a trusted home LAN or VPN.

`shv` is intentionally personal and local: one user, Docker Compose deployment, no built-in accounts, and no public-internet deployment assumption.

## Features

- Save videos into a local category-based library.
- Download direct video files, HLS streams, and DASH streams.
- Use a Chromium helper extension for pages where the final media URL appears only during playback.
- Track queued, running, failed, canceled, and completed downloads.
- Stream saved videos back from the local library with thumbnail and metadata support.

## Interface Preview

![Library grid with saved videos and categories](docs/assets/shv-library.png)

![Add video dialog for queueing a download](docs/assets/shv-add-video.png)

![Download queue with manual selection and retry states](docs/assets/shv-queue.png)

## Important Safety Notes

- Use `shv` only for content you own, created, are allowed to download, or are otherwise legally permitted to save.
- `shv` does not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.
- The application has no built-in authentication or authorization. Do not expose it directly to the public internet.
- Docker Compose binds to `0.0.0.0` by default so devices on a trusted LAN can reach the app.

See [SECURITY.md](SECURITY.md) for security, cookie, browser-extension, and reporting notes.

## Quick Start

Run the app with Docker Compose:

```bash
docker compose up --build
```

For detached mode:

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:8080
```

Persistent host folders are mounted under `./data`:

- `./data/library` -> `/data/library`: category folders and downloaded videos.
- `./data/app` -> `/data/app`: SQLite database, thumbnails, Chromium profile state, diagnostics, and cookies used by download helpers.
- `./data/work` -> `/work`: temporary active download and media-processing files.

## Releases

Prebuilt release images are published to GHCR as `ghcr.io/zenderg/shv:vX.Y.Z`.

Release process and deployment snippets are documented in [docs/releases.md](docs/releases.md).

## Local Checks

Local commands are available for checks and tests:

```bash
npm test
npm run typecheck
npm run build
```

Application startup should remain Docker Compose based.

## Browser Extension

Manual source selection uses a local Chromium browser extension. The running app serves the current extension package at:

```text
http://127.0.0.1:8080/extension/shv-source-helper.zip
```

Download the extension package from the same app URL you use in the browser. If you open `shv` from a LAN address such
as `http://192.168.x.x:8080`, download the extension from that address too, then reload the unpacked extension in your
browser.

See [docs/browser-extension.md](docs/browser-extension.md) for installation, behavior, and troubleshooting details.

## Documentation

- [docs/architecture.md](docs/architecture.md): runtime layout, module ownership, queue behavior, and media pipeline boundaries.
- [docs/browser-extension.md](docs/browser-extension.md): helper extension installation and capture behavior.
- [docs/development.md](docs/development.md): local checks, Docker/Codex notes, and downloader implementation notes.
- [docs/releases.md](docs/releases.md): release workflow, GHCR image tags, and deployment snippet.
- [docs/superpowers/specs/2026-07-06-local-video-library-design.md](docs/superpowers/specs/2026-07-06-local-video-library-design.md): product design specification.

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

## Frontend UI Notes

Design the library UI touch-first. Phones and tablets are supported browsing surfaces, so primary actions must remain visible and usable without hover. Hover and focus states can add polish, but they must not be the only way to discover or use video, category, queue, or dialog actions.

## Downloader Boundary

Generic sites should continue to use the built-in web/media pipeline: HTTP probing, Playwright/extension network capture, HTML media extraction, HLS/DASH manifest handling, and ffmpeg/ffprobe.

Site-specific downloader engines are allowed only behind explicit extractors for known complex platforms. YouTube uses `yt-dlp` because `googlevideo` playback URLs can be bound to player/runtime details that are not replayable by the generic downloader.

Do not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.

## HLS and DASH Notes

DASH manifests are XML, so representation URLs may contain escaped query separators such as `&amp;`; the downloader decodes those before invoking ffmpeg.

HLS/DASH downloads write to an extensionless work file, so ffmpeg remux calls pass an explicit output muxer.

HLS/DASH downloads are delegated to ffmpeg because it already handles playlist traversal, segment fetching, and stream copy/remux without reimplementing media container rules in TypeScript. HLS progress should come from ffmpeg's structured `-progress` output and media-playlist `#EXTINF` durations, not from stderr activity.

For HLS segment reliability, keep the ffmpeg reconnect options enabled and keep HLS `http_persistent` disabled; some signed segment CDNs can invalidate or truncate keepalive/TLS sessions mid-download, producing partial segments and corrupt audio packets.

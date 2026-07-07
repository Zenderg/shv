# shv

Self-hosted local video library and downloader for a trusted home LAN or VPN.

shv is intentionally personal and local: one user, Docker Compose deployment, no built-in accounts, and no public-internet
deployment assumption.

## Safety and Legal Notes

- Use shv only for content you own, created, are allowed to download, or are otherwise legally permitted to save.
- shv does not support DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.
- The application has no built-in authentication or authorization. Do not expose it directly to the public internet.
- Docker Compose binds to `0.0.0.0` by default so devices on a trusted LAN can reach the app.
- The optional Chromium helper extension uses broad permissions, including `<all_urls>`, `webRequest`, and `cookies`, to
  capture media candidates from pages opened by the user. Review the extension source before installing it.
- Do not share `./data/app`, `youtube-cookies.txt`, exported logs, screenshots, or the SQLite database publicly.

The product specification lives in:

- [docs/superpowers/specs/2026-07-06-local-video-library-design.md](docs/superpowers/specs/2026-07-06-local-video-library-design.md)

## Run

The application is designed to run through Docker Compose:

```bash
docker compose up --build
```

For Codex/browser debugging, prefer detached mode so the app stays up while the thread continues:

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:8080
```

`http://127.0.0.1:8080/` is the most reliable URL for the in-app Codex browser.

Codex sandbox notes:

- Docker Compose needs access to the Docker socket, so `docker compose up -d --build` and `docker compose ps` may need sandbox escalation.
- If sandboxed `curl` cannot reach port `8080` but `docker compose ps` shows `0.0.0.0:8080->8080/tcp`, retry the HTTP check with escalation before assuming the app is down.
- The in-app browser can open and evaluate the page even if `domSnapshot()` fails with `incrementalAriaSnapshot is not a function`; verify with page URL, title, or a small read-only `evaluate` instead.

Persistent host folders are mounted under `./data`:

- `./data/library` -> `/data/library`: category folders and downloaded videos.
- `./data/app` -> `/data/app`: SQLite database, thumbnails, Chromium profile state, diagnostics.
- `./data/work` -> `/work`: temporary active download and media-processing files.

Generic sites should continue to use the built-in web/media pipeline: HTTP probing, Playwright/extension network capture,
HTML media extraction, HLS/DASH manifest handling, and ffmpeg/ffprobe. Site-specific downloader engines are allowed only
behind explicit extractors for known complex platforms; YouTube uses `yt-dlp` because `googlevideo` playback URLs can be
bound to player/runtime details that are not replayable by the generic downloader.

## Local Checks

Local commands are allowed for checks and tests:

```bash
npm test
npm run typecheck
npm run build
```

Application startup should remain Docker Compose based.

## Browser Extension

Manual source selection uses a local Chromium browser extension so source pages open as normal browser tabs with a live
Sources sidebar embedded directly into the source page. The current extension package is served by the running app:

```text
http://127.0.0.1:8080/extension/shv-source-helper.zip
```

Install or update it locally:

1. Download the zip from the running app.
2. Unzip it somewhere stable on this machine.
3. Open the browser extensions page (`chrome://extensions`, `browser://extensions`, or the equivalent page in that browser).
4. Enable Developer mode.
5. Choose Load unpacked and select the unzipped `shv-source-helper` folder.

The unpacked extension has a stable manifest key, so its expected Chrome extension id is:

```text
ncgeehcdlbbdgojleaoefhhdinmdhcaf
```

When `Choose source` is clicked, the app checks for this extension and its protocol version. If it is missing or old,
the app shows an install/update dialog with the same download link and instructions.

Do not require users to enable Yandex's `YandexSidePanel` feature flag or depend on Chrome's native `sidePanel` API.
The production UX is the in-page Sources sidebar injected by the extension content script.

The Sources sidebar captures candidates around active playback instead of listing every media-looking request on the
page. Start the main video first; the content script reports playback from one visible dominant `<video>`, and the
service worker accepts recent network candidates only during a short rolling active window. Byte-range URLs such as
`?bytes=0-6402` are ignored because they are chunks, not standalone downloadable sources.
Extensionless media request URLs with an explicit `mime=video/...` query hint are treated like direct video responses;
large video platforms commonly use that shape for playable media while response headers may be hidden from ordinary
extension header observation.
YouTube/Chromium can also expose `*.googlevideo.com/videoplayback` requests without a visible video `Content-Type` or
`mime` query parameter. Those request URLs are accepted as browser-request candidates unless they carry explicit
`bytes` or `range` query parameters, which indicate a chunk rather than a standalone source.
Do not accept explicit YouTube SABR/UMP transport requests (`sabr=1`) as direct candidates; they can download as tiny
`sabr.malformed_config` responses outside the browser's streaming stack. A `googlevideo` `/videoplayback` response with
`application/vnd.yt-ump` but without `sabr=1` is still treated as a selectable playback request.
The content script runs in all frames so embedded players, such as VK video inside a Yandex page, can report active
playback. Only the top frame owns the visible Sources sidebar and the app bridge.
Some embedded players do not expose a usable DOM `<video>` to extension content scripts while still streaming media
requests. For those cases, start playback and click Capture now in the Sources sidebar; this opens the same short active
capture window manually without returning to whole-page passive collection. Capture now should show a short Listening
state; if the list stays empty, keep playback running or seek so the player emits a fresh media request during that
window.
Captured network candidates keep a limited downloader header allowlist such as `Referer`, `User-Agent`, and `sec-ch-ua*`
because some signed media hosts return errors when the server retries the URL without the original browser request
context.
YouTube page URLs are handled by the backend `yt-dlp` source extractor. Do not route YouTube through extension-side file
downloads: extension service-worker `fetch` is not the same network path as the YouTube player media pipeline and still
receives HTTP 403 for some signed `googlevideo` URLs.
Some sites require an authenticated browser session. When `Use source` is clicked, the Chrome extension collects cookies
for the source page and selected media URLs, sends only those cookies to the local app at `127.0.0.1:8080`, and adds a
`Cookie` header to matching media candidates. The backend merges uploaded cookies into the Netscape-format file at
`./data/app/youtube-cookies.txt` on the host so `yt-dlp` can use them for YouTube and other site-specific extractors.
Set `YTDLP_COOKIES_FILE` only when the container should use a different mounted cookie-file path. The extension does not
upload the whole browser cookie jar.
When capture stays empty, the Sources sidebar shows a Diagnostics block with DOM video counts, active-playback status,
and media-like network/classifier counters. Use that block first to determine whether the break is in page playback
detection, network observation, tab/session mapping, or URL classification.
DASH manifests are XML, so representation URLs may contain escaped query separators such as `&amp;`; the downloader
decodes those before invoking ffmpeg.
HLS/DASH downloads write to an extensionless work file, so ffmpeg remux calls pass an explicit output muxer.
HLS/DASH downloads are delegated to ffmpeg because it already handles playlist traversal, segment fetching, and stream
copy/remux without reimplementing media container rules in TypeScript. HLS progress should come from ffmpeg's structured
`-progress` output and media-playlist `#EXTINF` durations, not from stderr activity. For HLS segment reliability, keep
the ffmpeg reconnect options enabled and keep HLS `http_persistent` disabled; some signed segment CDNs can invalidate
or truncate keepalive/TLS sessions mid-download, producing partial segments and corrupt audio packets.
When a user explicitly clicks Use source in the extension, treat the posted candidates as the current source-session
snapshot rather than merging them forever with older captures; stale signed HLS URLs can otherwise survive in the queue
and race with the selected candidate. If both master and media HLS playlists are shown, prefer the concrete media
playlist such as `index-v1-a1.m3u8`; `master.m3u8` is only a variant playlist and adds an extra signed-manifest fetch
before ffmpeg can start reading segments.

Hovering or focusing a candidate should visually highlight the related media area only when the extension can make a
credible match. Direct DOM candidates highlight their matching element; network-only candidates highlight a dominant
visible video/player when one is obvious. They intentionally avoid highlighting small preview videos or recommendation
tiles, because those URLs often are not present as DOM attributes and a false highlight is worse than no page overlay.

## Architecture Notes

Implementation details and module ownership are documented in:

- [docs/architecture.md](docs/architecture.md)

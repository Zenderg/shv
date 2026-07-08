# Browser Extension

This document is the source of truth for the Chromium helper extension's packaging, installation, runtime behavior, and development workflow. Put broad product behavior in [docs/product.md](product.md), backend/frontend module ownership in [docs/architecture.md](architecture.md), deep capture debugging notes in [docs/browser-extension-debugging.md](browser-extension-debugging.md), and release procedure in [docs/releases.md](releases.md).

Manual source selection uses a local Chromium browser extension so source pages open as normal browser tabs with a live Sources sidebar embedded directly into the page.

The extension packages are served by the running app:

```text
Production profile: http://127.0.0.1:8080/extension/shv-source-helper.zip
Development profile: http://127.0.0.1:8080/extension/shv-source-helper-dev.zip
```

The downloaded package is tailored to the app origin that served it. In production, download it from the same URL where
the app is open so the extension manifest allows that origin and the service worker posts candidates back to that
origin. If the app runs behind a reverse proxy that hides the public scheme or host from Node, set `PUBLIC_APP_ORIGIN`
to the browser-visible origin, for example `https://videos.example.com`.

The runtime files under `extension/chrome-source-helper` are shared by both packages. The server rewrites only the
packaged manifest profile and app origin constants in both `shared.js` and the generated `content-script.js`. The app
uses the production extension profile by default, even on localhost or private LAN origins. Set
`SOURCE_EXTENSION_PROFILE=dev` to make the app expect the development extension id and show the development package in
install/update instructions; the repository Docker Compose file sets this for local development convenience.

The Sources sidebar content script is generated from `src/extension/source-helper` with Svelte. Run
`npm run build:extension` after editing that source; `npm run build` runs it before the web and server builds. Do not
hand-edit `extension/chrome-source-helper/content-script.js` except for emergency debugging, because the next extension
build will replace it.

## Versioning

Whenever extension runtime behavior, manifest permissions, packaged files, or app-extension protocol expectations
change, bump the helper extension version before finishing the change. Keep these values aligned:

```text
extension/chrome-source-helper/manifest.json version
extension/chrome-source-helper/shared.js EXTENSION_VERSION
src/web/src/lib/extensionBridge.ts SOURCE_EXTENSION_REQUIRED_VERSION
```

The unit test `tests/unit/extensionManifest.test.ts` verifies this alignment. Update bridge tests that intentionally
mock the current ready version at the same time.

## Visual Preview

For sidebar layout work that does not need real browser-extension APIs, run:

```text
npm run preview:extension
```

This starts a local Vite-only visual harness at `http://127.0.0.1:5174`. It mounts the real `SourceSidebar` component in
Shadow DOM with mocked states for collapsed, empty, listening, candidate, selected, and long-URL views. It intentionally
does not require Docker Compose, a loaded browser extension, cookies, or source capture runtime. Use the full Docker
Compose app plus a real unpacked extension when validating `Use source`, extension messaging, network capture, cookies,
or server integration.

## Install or Update

1. Download the zip from the running app.
2. Unzip it somewhere stable on this machine.
3. Open the browser extensions page (`chrome://extensions`, `browser://extensions`, or the equivalent page in that browser).
4. Enable Developer mode.
5. Choose Load unpacked and select the unzipped `shv-source-helper` or `shv-source-helper-dev` folder shown by the app.

The unpacked extensions have stable manifest keys. The expected Chrome extension ids are:

```text
Production: ncgeehcdlbbdgojleaoefhhdinmdhcaf
Development: jglagfhfffmokhgmaijndppinlbolpee
```

When `Choose source` is clicked, the app checks the extension id selected by `SOURCE_EXTENSION_PROFILE` and verifies
its protocol version. If it is missing or old, the app shows an install/update dialog with the matching download link
and instructions.

The app is commonly opened from another LAN device over plain HTTP, for example `http://192.168.x.x:8080`. Browser-side extension bridge code must not require HTTPS-only Web Crypto APIs such as `crypto.randomUUID`; use a fallback request id when probing the content-script bridge.

## Capture Behavior

The production UX is the in-page Sources sidebar injected by the extension content script. Do not require users to enable Yandex's `YandexSidePanel` feature flag or depend on Chrome's native `sidePanel` API.

The sidebar can be collapsed into a narrow right-edge handle with its arrow button and expanded again with the same control.

The Sources sidebar captures candidates around active playback instead of listing every media-looking request on the page. Start the main video first; the content script reports playback from one visible dominant `<video>`, and the service worker accepts recent network candidates only during a short rolling active window. Byte-range URLs such as `?bytes=0-6402` are ignored because they are chunks, not standalone downloadable sources.

Subtitle tracks are captured as metadata for media candidates, not as standalone downloadable sources. The extension may
detect them from browser network requests, DOM text tracks, or HLS manifest metadata, and the Sources sidebar should
present them as detected subtitles. It should not claim they are already burned into the video or that a particular track
will be used until the main queue UI records the user's subtitle choice.

When the sidebar is open, content scripts report concrete `videoWidth` and `videoHeight` from the active playback element so direct `video/*` browser-request candidates can inherit the player's verified resolution even when the media URL came from an embedded frame. That playback metadata is tied to the active element's exact `currentSrc`; do not apply it globally to every video request in the active capture window, because quality switches can emit the new network request a fraction of a second before the player reports the new resolution. If a matching network request is already pending, the service worker reprocesses it when the matching `currentSrc` playback signal arrives. The top-frame sidebar may also probe direct video candidates with a hidden `<video preload="metadata">` element. A failed probe should show `resolution unavailable` and emit a debug event rather than inferring resolution from URL parameters, response size, or CDN-specific query fields.

HLS resolution should come from real manifest metadata or the active player state, not from media segment URLs. The service worker may fetch captured `.m3u8` manifests with browser cookies and parse `#EXT-X-STREAM-INF` `RESOLUTION` attributes; when a master playlist references a media playlist, the matching media playlist candidate inherits that variant resolution. Media playlists without variant metadata must remain unresolved instead of guessing from names such as `1080P` in the path.

In the development extension profile, metadata probe failures and other extension diagnostics are posted to the app's in-memory debug feed. Use `GET /api/debug/extension/events` to inspect recent events, or `GET /api/debug/extension/events?limit=25` for a shorter window. These routes intentionally return 404 outside the development extension profile.

Extensionless media request URLs with an explicit `mime=video/...` query hint are treated like direct video responses; large video platforms commonly use that shape for playable media while response headers may be hidden from ordinary extension header observation.

YouTube/Chromium can expose `*.googlevideo.com/videoplayback` requests without a visible video `Content-Type` or `mime` query parameter. Those request URLs are accepted as browser-request candidates unless they carry explicit `bytes` or `range` query parameters, which indicate a chunk rather than a standalone source.

Do not accept explicit YouTube SABR/UMP transport requests (`sabr=1`) as direct candidates; they can download as tiny `sabr.malformed_config` responses outside the browser's streaming stack. A `googlevideo` `/videoplayback` response with `application/vnd.yt-ump` but without `sabr=1` is still treated as a selectable playback request.

YouTube page URLs are handled by the backend `yt-dlp` source extractor. Do not route YouTube through extension-side file downloads: extension service-worker `fetch` is not the same network path as the YouTube player media pipeline and can still receive HTTP 403 for some signed `googlevideo` URLs.

## Embedded Players

The extension statically loads the content script only on the app origin so the app-page bridge can work. Source pages are injected programmatically when the app opens a source tab or the user toggles the extension action. That source-page injection targets all existing frames. The service worker also observes source-tab navigation with `webNavigation`: top-frame commits must restore the visible Sources sidebar after redirects or SPA document swaps, while child-frame commits get content-script injection so embedded players created after the sidebar opens, such as VK video inside a Yandex page, can report active playback. Only the top frame owns the visible Sources sidebar and the app bridge.

Some embedded players do not expose a usable DOM `<video>` to extension content scripts while still streaming media requests. For those cases, start playback and click Capture now in the Sources sidebar; this opens the same short active capture window manually without returning to whole-page passive collection.

Capture now should show a short Listening state. If the list stays empty, keep playback running or seek so the player emits a fresh media request during that window.

When Chromium reports a media request without a concrete tab id, the service worker maps it back to a source session
only when the request can be matched unambiguously. If multiple open source sessions share the same origin, such as two
YouTube tabs, origin-only tabless requests are not attached to every session; the active capture diagnostics record them
as unmapped instead.

## Cookies and Request Context

Some sites require an authenticated browser session. When `Use source` is clicked, the Chrome extension collects cookies
for the source page, the current page URL, the selected media URL, and all media candidate URLs in the current source
session. It sends only those matching URL cookies to the app origin embedded in the downloaded extension package and
adds a `Cookie` header to matching media candidates.

The backend merges uploaded cookies into the Netscape-format file at `./data/app/youtube-cookies.txt` on the host so `yt-dlp` can use them for YouTube and other site-specific extractors. Set `YTDLP_COOKIES_FILE` only when the container should use a different mounted cookie-file path. The extension does not upload the whole browser cookie jar.

Captured network candidates keep a limited downloader header allowlist such as `Referer`, `User-Agent`, and `sec-ch-ua*` because some signed media hosts return errors when the server retries the URL without the original browser request context.

## Candidate Selection

When a user explicitly clicks Use source in the extension, treat the posted candidates as the current source-session snapshot rather than merging them forever with older captures; stale signed HLS URLs can otherwise survive in the queue and race with the selected candidate.

If both master and media HLS playlists are shown, prefer the concrete media playlist such as `index-v1-a1.m3u8`; `master.m3u8` is only a variant playlist and adds an extra signed-manifest fetch before ffmpeg can start reading segments.

If a selected source has supported subtitle tracks, `Use source` sends all detected tracks with that candidate and the
job moves to the app's `needs_subtitle_selection` state. The extension does not choose one subtitle track from source
page UI state. Custom player menus are too site-specific: a click on text such as `Russian`, `English`, or `Off` is not
a stable cross-site signal, and hardcoding those labels would make the extension wrong on other players.

The sidebar's visible source list is a presentation layer over the full source-session snapshot. Keep the complete `session.candidates` set available for cookie collection, backend candidate replacement, selection lookup, and debugging, while rendering only the candidates that are actionable for the active playback when the extension has enough player or manifest evidence. For HLS, prefer a concrete media playlist that matches the active playback resolution and hide related master or other-resolution playlists from the ordinary list.

When the active visible player emits `pause` or `ended`, the content script marks the session playback as inactive. Keep the existing candidate snapshot visible for diagnosis, but disable source selection until playback resumes; the service worker must also reject stale `SHV_SELECT_SOURCE` messages so an old sidebar render cannot start a download from a paused player URL. Manual Capture now sessions without visible playback remain selectable while their capture window is active, because some embedded players do not expose a usable DOM `<video>`.

Hovering or focusing a candidate should visually highlight the related media area only when the extension can make a credible match. Direct DOM candidates highlight their matching element; network-only candidates highlight a dominant visible video/player when one is obvious. They intentionally avoid highlighting small preview videos or recommendation tiles, because those URLs often are not present as DOM attributes and a false highlight is worse than no page overlay.

## Diagnostics

When capture stays empty, the Sources sidebar shows a Diagnostics block with DOM video counts, active-playback status, and media-like network/classifier counters. Use that block first to determine whether the break is in page playback detection, network observation, tab/session mapping, or URL classification.

For future-agent debugging playbooks, resolution evidence rules, and rejected extension-capture approaches, see [docs/browser-extension-debugging.md](browser-extension-debugging.md).

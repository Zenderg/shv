# Browser Extension Debugging

This document is the source of truth for agent-facing debugging notes, evidence rules, and rejected approaches for the Chromium helper extension's source-capture flow. Keep the current runtime contract in [docs/browser-extension.md](browser-extension.md), broad module ownership in [docs/architecture.md](architecture.md), durable product decisions in [docs/decisions.md](decisions.md), and local command workflow in [docs/development.md](development.md).

Use this document when a future agent needs to understand why the extension captures or displays a source a certain way, especially around resolution detection, embedded players, and HLS manifests.

## First Principles

- Prefer evidence from the user's real browser over assumptions. The extension runs inside the user's Chromium profile, not inside Codex, so Codex cannot directly inspect extension DevTools, current cookies, real page DOM, or player internals unless the app/extension explicitly reports them.
- Use the development extension profile for capture debugging. The local Docker Compose file sets `SOURCE_EXTENSION_PROFILE=dev`, and the dev profile exposes `GET /api/debug/extension/events`.
- Keep the capture model narrow: the sidebar captures candidates around active playback, not every media-looking request on the page. Whole-page passive collection creates noisy, stale, and wrong candidates.
- Do not infer source quality from URL names, query parameters, response size, CDN hostnames, or bitrate-like path fragments. Show `resolution unavailable` unless the app has real media metadata.
- Do not add fallback mechanics without explicit user approval. Fallbacks make this subsystem harder to debug because the same card can be produced by multiple unrelated paths.

## Important Runtime Files

- `extension/chrome-source-helper/shared.js`: plain JS shared by service worker and content script bundle. Candidate classification, merging, extension version, and HLS manifest metadata parsing live here.
- `extension/chrome-source-helper/service-worker.js`: observes browser network requests, maps them to source sessions, stores capture state, fetches HLS manifests for metadata, posts candidates/cookies/debug events to the app.
- `src/extension/source-helper/contentScript.ts`: injected source-page runtime. Owns the visible top-frame Sources sidebar, reports active playback, probes direct video metadata, and reports diagnostics.
- `src/extension/source-helper/SourceSidebar.svelte`: sidebar UI. Resolution states are rendered here.
- `src/server/api/routes.ts`: extension package, candidate, cookie, and dev debug routes.
- `src/server/extension-debug/extensionDebugService.ts`: in-memory dev-only debug event store.
- `src/web/src/lib/extensionBridge.ts`: app-to-extension handshake, required extension version, extension id selection.

Do not hand-edit `extension/chrome-source-helper/content-script.js` for durable changes. Edit `src/extension/source-helper/*` and run the extension/web build.

## Debugging Workflow

1. Confirm the app is running through Docker Compose, not a host-local dev server:

```bash
docker compose up -d --build
```

2. Confirm the dev extension package is available:

```bash
curl -s -I http://127.0.0.1:8080/extension/shv-source-helper-dev.zip
```

3. Confirm the browser has reloaded the unpacked dev extension after any extension runtime/version change. Extension runtime changes require a version bump and a reload on `chrome://extensions` or the browser's equivalent page.

4. Ask the user to reproduce in their normal Chromium browser: open source, start playback, switch quality if needed, and click `Capture now` if playback is hidden or embedded.

5. Inspect extension debug events:

```bash
curl -s 'http://127.0.0.1:8080/api/debug/extension/events?limit=50'
```

6. Interpret events in this order:

- `active-playback`: content script found a dominant playing `<video>`. Check `details.currentSrc` and `details.playbackMetadata.resolution`.
- `network-candidate`: service worker classified and mapped a browser request to the source session. Check `details.contentType`, `details.statusCode`, `details.requestType`, and `details.headerKeys`.
- `metadata-probe`: top-frame hidden `<video preload="metadata">` probe result for direct video candidates.
- `hls-manifest`: service-worker HLS manifest fetch/parse result. `status: available` means manifest metadata produced a resolution; `unavailable` keeps the UI honest.

If no `network-candidate` appears, investigate request classification or tab/session mapping. If `network-candidate` appears but no resolution does, investigate the resolution path for that candidate kind.

## Resolution Detection Contract

Direct video candidates can get resolution from two evidence sources:

- active playback metadata: `video.videoWidth` and `video.videoHeight` reported by the content script for the dominant playing `<video>`;
- hidden top-frame metadata probe: a temporary `<video preload="metadata">` element loads the candidate URL and reads `videoWidth/videoHeight`.

Active playback metadata is applied only to the exact `currentSrc` URL when `currentSrc` is HTTP(S). Do not apply the active player resolution globally to every candidate in the active capture window. Quality switches can emit the new network request before the player reports the new `videoWidth/videoHeight`, and global application can label the wrong quality.

If the active player's `currentSrc` is `blob:...`, exact URL matching cannot connect player metadata to captured HTTP(S) manifest URLs. For HLS in this shape, rely on manifest metadata instead of trying to map the blob back to a source URL.

When metadata is not available, the UI should show `resolution unavailable` for attempted probes rather than hiding the problem behind a guessed value.

## HLS Resolution Contract

HLS candidates are accepted from `.m3u8` URLs or `mpegurl` content types. The service worker may fetch captured HLS manifests with `credentials: 'include'` and a deliberately small header set.

Resolution comes only from master-playlist variant metadata:

```text
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1920
index-v1-a1.m3u8
```

The parser stores resolution for:

- the master playlist candidate itself, using the best parsed variant;
- each variant media-playlist URL resolved relative to the master playlist URL.

If the media playlist candidate was already captured before the master playlist was parsed, the service worker updates the existing candidate after the master metadata arrives. This is the important case for sites where the panel initially shows both `master.m3u8` and `index-v1-a1.m3u8`.

Media playlists without `#EXT-X-STREAM-INF` variant metadata must remain unresolved. Do not infer resolution from path fragments like `1080P`, `4000K`, `v1`, or CDN-specific query fields.

The service-worker manifest fetch is not identical to the original media pipeline request. It runs in the extension service worker with host permissions and browser cookies, which is good enough for many ordinary manifests, but some sites can still reject it. When that happens, keep the card unresolved and use the `hls-manifest` debug event to see the HTTP status or fetch failure.

## Headers And Cookies

Network candidates keep a downloader header allowlist such as `Referer`, `User-Agent`, and `sec-ch-ua*` because some signed hosts require the original browser request context when the backend retries a selected URL.

HLS manifest metadata fetches inside the service worker intentionally use fewer headers: currently `Accept` and `Accept-Language` only, plus `credentials: 'include'`. Do not pass captured headers such as `User-Agent`, `Referer`, `sec-*`, or `Origin` into normal extension `fetch` without checking browser restrictions; several of them are forbidden or fragile in service-worker fetch.

When `Use source` is clicked, the extension collects cookies for the source page, current page URL, selected media URL, and all media candidate URLs in the current source session, then sends only those matching URL cookies to the app. It does not upload the whole browser cookie jar.

## Embedded Player Notes

Source-page content scripts are injected programmatically into all existing frames when the source tab opens or the user toggles the extension action. The service worker also observes `webNavigation.onCommitted` for new child-frame navigations and injects `content-script.js` into active source tabs. This matters for players that create iframes after the sidebar opens.

Only the top frame owns the visible sidebar and the app bridge. Child frames can still report active playback and diagnostics through extension messaging.

Some embedded players expose network requests but no usable DOM `<video>` to content scripts. In that case, `Capture now` is the expected user workflow: it opens the same short active capture window without requiring active playback detection from the DOM.

When Chromium reports media requests without a concrete tab id, the service worker maps them only when the request can be matched unambiguously to one source session. Do not attach ambiguous tabless requests to every same-origin source tab.

## What Not To Reintroduce

- Native browser side panel APIs or Yandex-specific side panel flags. The production UX is the injected in-page sidebar.
- Screenshot polling as the production manual-selection UX. Older Playwright/live-browser endpoints are diagnostics and fallback infrastructure, not the target flow.
- Global active-player resolution propagation. It mislabels quality after switches.
- Resolution guessing from URL path, query params, response size, bitrate labels, or CDN-specific request fields.
- Extension-side file downloads for YouTube. YouTube remains behind the backend `yt-dlp` extractor because captured `googlevideo` URLs can be bound to player/runtime behavior.
- Accepting explicit YouTube SABR/UMP transport requests (`sabr=1`) as candidates. They are transport payloads, not replayable direct sources.
- Whole-page passive media candidate listing. It produces stale and misleading source cards.
- A custom MCP/API control plane for the browser extension, unless the user explicitly asks to revisit it. The dev debug endpoint and user-triggered reproduction are the current debugging path.

## Change Checklist

For extension runtime changes:

1. Edit source files, not generated `content-script.js`, unless doing temporary emergency debugging.
2. Add focused tests only where they prove a real contract or regression.
3. Bump all aligned extension versions:

```text
extension/chrome-source-helper/manifest.json version
extension/chrome-source-helper/shared.js EXTENSION_VERSION
src/web/src/lib/extensionBridge.ts SOURCE_EXTENSION_REQUIRED_VERSION
```

4. Update bridge tests that mock the ready extension version.
5. Run:

```bash
npm test
npm run typecheck
npm run build
```

6. Start or rebuild with Docker Compose before asking the user to test:

```bash
docker compose up -d --build
```

7. Tell the user to reload the unpacked extension, then reproduce in their real browser.

Useful regression tests for this subsystem currently include:

- `tests/unit/extensionShared.test.js`: candidate classification, verified currentSrc candidates, merge semantics, HLS manifest parsing.
- `tests/unit/extensionServiceWorker.test.js`: request-header preservation, active playback metadata, HLS variant resolution enrichment, dynamic child-frame injection.
- `tests/unit/sourceSidebarSource.test.ts`: resolution UI states.
- `tests/unit/extensionManifest.test.ts`: version/permission alignment.
- `tests/unit/extensionDebugRoute.test.ts`: dev-only debug event route.

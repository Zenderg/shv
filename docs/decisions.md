# Decision Log

This file keeps durable rationale: what we chose, what we rejected, and why. It is not an implementation plan, product checklist, changelog, or scratchpad. Put current product behavior in [docs/product.md](product.md), current module contracts in [docs/architecture.md](architecture.md), and local workflow notes in [docs/development.md](development.md).

## Personal LAN/VPN App, Not A Public Service

**Decision:** `shv` targets one trusted user on a trusted home LAN or user-managed VPN.

**Why:**

- The primary problem is saving and browsing a personal local video library, not operating a public downloader service.
- The target is production use for that personal/local scope, not an MVP-only sketch.
- Avoiding accounts, roles, password reset, tenant isolation, and abuse controls keeps the product small enough to run and reason about locally.
- LAN/VPN access matches the expected tablet/laptop workflow.

**Rejected alternatives:**

- Built-in authentication and authorization.
- Public-internet deployment as a supported default.
- Multi-user permissions or shared-library ownership.

If remote access is needed, an external reverse proxy, VPN, or access layer owns authentication, HTTPS, and network controls.

## Docker Compose As The Startup Contract

**Decision:** Application startup is Docker Compose based.

**Why:**

- The runtime needs Node, Chromium/Playwright, ffmpeg/ffprobe, `yt-dlp`, and `curl_cffi`; Docker keeps that media/browser stack reproducible.
- Bind mounts make the storage contract explicit: `/data/library`, `/data/app`, and `/work`.
- The app is intended to be deployed as one local service, not assembled from many host-installed tools.

**Rejected alternatives:**

- Requiring developers or users to install Chromium, ffmpeg, Python packages, and Node tools directly on the host for normal startup.
- Splitting the first version into multiple deployable services.

Local commands are still fine for tests, builds, scripts, seed data, and screenshot capture.

## TypeScript Modular Monolith

**Decision:** The app is a TypeScript modular monolith: Express backend, React frontend, Svelte-authored extension sidebar, Vite builds, and explicit server-side modules.

**Why:**

- One deployable process is enough for the product's single-user queue and local library model.
- TypeScript keeps shared contracts practical across UI, API, queue, extension bridge, and tests.
- A modular monolith gives separate ownership boundaries without paying the operational cost of services.

**Rejected alternatives:**

- A microservice split for queue, media processing, storage, and UI.
- Introducing Rust for the initial downloader or media path before TypeScript hits a clear limit.
- Building the product as a Python application.

Rust can still be introduced later for isolated low-level components if there is a concrete performance or reliability reason. Python is present in the Docker image for `yt-dlp` and `curl_cffi`; it is not the application language.

## SQLite In App Data

**Decision:** Persistent application state uses SQLite under `/data/app`.

**Why:**

- The product is single-user and local, so a server database would add administration without solving a current product problem.
- SQLite keeps backup and migration expectations simple for a bind-mounted local app.
- Explicit migrations make schema changes reviewable.

**Rejected alternatives:**

- Postgres as a default dependency.
- A database-less design that infers library state only from folders.

The filesystem remains the source of media bytes; SQLite owns categories, media metadata, queue state, candidates, and settings.

## Category-First Library

**Decision:** Browsing is category-first with flat categories that map to folders directly under `/data/library`.

**Why:**

- Human-readable category folders keep the saved library understandable outside the app.
- Flat categories keep rename, move, delete, and path-containment behavior tractable.
- The expected use is deliberate saving into known buckets, not managing a large public catalog.

**Rejected alternatives:**

- Nested categories.
- Global search as a required first-class navigation path.
- Duplicate detection or content deduplication.
- A completed-download history as the primary browsing surface.

Category display names may change, but folder names stay stable so existing media paths do not churn.

## Queue First, No Metadata Preview Gate

**Decision:** Adding a link creates a visible queue job immediately. The system starts work and asks for manual input only when needed.

**Why:**

- Many pages cannot expose reliable metadata until the browser or downloader starts real analysis.
- A queue item gives the user a recoverable state for failures and manual selection.
- One active job at a time is easier to cancel, diagnose, and resume after restart.

**Rejected alternatives:**

- Blocking submission on a metadata preview.
- Running many downloads in parallel by default.
- Hiding completed state in a separate history screen instead of the library.

## Generic Downloader First, Explicit Extractors Only For Known Hard Platforms

**Decision:** The default path is source-agnostic detection and download. Site-specific engines are allowed only behind explicit extractor boundaries for known complex platforms.

**Why:**

- Direct files, HLS, DASH, HTML media tags, Playwright network capture, and extension capture cover the general shape of the product.
- Keeping generic mechanisms first prevents the app from becoming a pile of site scrapers.
- Some platforms bind playback URLs to player/runtime behavior that a generic server retry cannot reproduce.

**Rejected alternatives:**

- Making `yt-dlp` the universal downloader for every URL.
- Banning all site-specific extractors after evidence showed YouTube `googlevideo` URLs can be non-replayable outside the player pipeline.
- Extension-side file downloads for YouTube; the extension service worker is still not the same request context as the player media stack.

YouTube currently uses `yt-dlp` through `src/server/source-extractors/sourceExtractorService.ts`. Generic extension/manual capture remains the path for ordinary direct, HLS, and DASH media URLs.

## Preserve Quality Before Transcoding

**Decision:** Media processing keeps the original file when it is already browser-friendly, remuxes compatible streams when only the container needs adjustment, and transcodes only when needed.

**Why:**

- Transcoding is slow and loses quality.
- Browser playback compatibility matters more than pretending to improve source quality.
- ffprobe and ffmpeg provide stable low-level media inspection and conversion tools.

**Rejected alternatives:**

- Always transcoding to H.264/AAC MP4.
- Trusting source-page poster images instead of generating thumbnails from the saved file.
- Accepting remux outputs whose duration or timestamp ordering is clearly broken.

## Extension-First Manual Source Selection

**Decision:** Manual source selection uses a Chromium extension that opens source pages as normal browser tabs and injects an in-page Sources sidebar.

**Why:**

- Many sites block iframe embedding, so a normal iframe cannot be the primary manual-selection surface.
- A real browser tab lets users handle login, age gates, consent UI, embedded players, and playback gestures naturally.
- The extension can observe browser network requests and collect selected cookies only when the user explicitly clicks `Use source`.

**Rejected alternatives:**

- Relying on screenshots or screenshot polling as the production UX.
- Depending on Chrome's native `sidePanel` API or Yandex-specific side panel flags.
- Listing every media-looking request on a noisy page.

## Evidence-Based Extension Resolution

**Decision:** Extension source cards show resolution only when it comes from real player or manifest metadata.

**Why:**

- Direct browser-request videos can be labeled from the active `<video>` element's `videoWidth/videoHeight` or from a hidden metadata probe.
- HLS playlists can be labeled from master-playlist `#EXT-X-STREAM-INF` `RESOLUTION` attributes, including applying a parsed variant resolution back to the matching media-playlist candidate.
- Embedded players can expose `blob:` player URLs while streaming HTTP(S) manifests, so exact currentSrc matching cannot solve every HLS case.
- Incorrect resolution is worse than missing resolution because the user may choose a lower-quality source believing it is higher quality.

**Rejected alternatives:**

- Guessing resolution from URL fragments such as `1080P`, bitrate-looking names, CDN query fields, response size, or segment URLs.
- Applying the active player resolution globally to every candidate in the active capture window.
- Adding a custom MCP/API control plane for extension debugging before the current dev debug feed proves insufficient.

Future extension debugging details live in [docs/browser-extension-debugging.md](browser-extension-debugging.md).

The older Playwright live-browser screenshot endpoints remain useful diagnostics and fallback infrastructure, but they are not the target UX.

## Active Playback Capture

**Decision:** The extension records sources tied to active playback, not all media-looking traffic.

**Why:**

- Modern pages preload recommendations, ads, previews, and byte ranges that are not the user's chosen video.
- A visible dominant `<video>` gives a practical activation signal.
- Some embedded players do not expose a usable DOM video element, so `Capture now` opens the same short active capture window explicitly.

**Rejected alternatives:**

- Passive whole-page collection.
- Showing explicit byte-range chunks such as `?bytes=0-6402` as downloadable sources.
- Highlighting small preview tiles when the extension cannot credibly map a network-only candidate to a DOM element.

Network candidates must include enough request context for server retry: a limited allowlist of browser headers plus selected cookies on the explicit `Use source` action.

## App-Owned Subtitle Selection

**Decision:** The extension detects available subtitle tracks, but the main app queue UI owns the user's subtitle choice.
If a selected candidate has supported subtitle tracks, the job pauses at `needs_subtitle_selection`; the user chooses one
track or `No subtitles`; a chosen track is burned into the final saved video.

**Why:**

- Source-player subtitle menus are not a stable web API. The visible text, DOM structure, language labels, and timing of
  network subtitle requests vary by player and site.
- Hardcoding labels such as `Off`, `Russian`, or `English` would accidentally make one site define the extension's
  behavior for every other site.
- The app can present an explicit, recoverable choice from the detected track metadata, which is easier to debug than
  trying to mirror arbitrary player state.
- Burning the selected subtitle into the output makes saved playback predictable in the app's default HTML5 player and
  avoids depending on browser-specific subtitle-track switching UI.

**Rejected alternatives:**

- Inferring the selected subtitle track from content-script click handlers on source-page menus.
- Automatically choosing all detected subtitle tracks and expecting the app player to expose a switcher.
- Saving subtitles only as sidecar metadata when the current product expectation is that selected subtitles display by
  default in the downloaded video.

## Seed Data Is Explicit And Local

**Decision:** Dev and showcase seed workflows are command-driven and never run during application startup.

**Why:**

- Local UI work needs fast fake libraries without exercising the downloader or ffmpeg.
- Real manual test data should survive seed runs.
- Reset must remove only generated seed data.

**Rejected alternatives:**

- Auto-seeding on app startup.
- Making placeholder `.mp4` files into media-pipeline fixtures.
- Bypassing category/media-library services when writing seed rows.

Dev seed rows use `dev-seed://` source URLs and `[dev] ` category prefixes. Showcase seed rows use their own prefixes and reset path.

## Tests Favor Deterministic Boundaries

**Decision:** Tests focus on boundaries most likely to regress: filesystem safety, category/media operations, queue transitions, HLS/DASH parsing, downloader behavior, extension packaging/bridge behavior, and seed reset safety.

**Why:**

- External websites are unstable test dependencies.
- Local fixture-style tests keep regressions actionable.
- The goal is verification, not test volume for its own sake.

**Rejected alternatives:**

- End-to-end tests that depend on live third-party video sites.
- Adding tests for every small implementation detail by default.

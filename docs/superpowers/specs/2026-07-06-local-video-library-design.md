# Local Video Library Design

Date: 2026-07-06

## Summary

`shv` is a personal local web application for saving videos from arbitrary web links into a categorized on-disk video library. The user opens the app from a tablet or laptop on the local network, pastes a link, selects or creates a flat category, and submits a download job. The app downloads one job at a time, stores the resulting video in the category folder, generates a thumbnail from the downloaded file, and makes the video playable in the same web interface.

This is a production-target design, not an MVP-only sketch. The system is still intentionally personal and local: one user, no accounts, no public-internet deployment, and no multi-user permissions.

## Product Goals

- Add video links from multiple personal devices on the same LAN or VPN.
- Support direct video URLs and page URLs where the actual video source must be discovered.
- Use a custom detection and download pipeline instead of site-specific downloader tools such as `yt-dlp`.
- Provide a manual selection flow when automatic detection is ambiguous or insufficient.
- Store videos in human-readable category folders on disk.
- Let the user watch, rename, move, and delete downloaded videos from the web UI.
- Keep deployment simple with one Docker container and bind-mounted persistent storage.

## Non-Goals

- No public internet exposure as a supported deployment mode.
- No login, passwords, roles, or multi-user authorization.
- No duplicate detection or deduplication.
- No global search; navigation is category-first.
- No nested categories.
- No download history view after successful completion.
- No DRM bypass, key extraction, paywall bypass, or circumvention of closed protection systems.
- No Python runtime or Python application code.
- No dependency on `yt-dlp`, `youtube-dl`, or similar site-specific downloader engines.

## Supported Deployment Model

The app runs as a Dockerized local service. The container exposes an HTTP port to the local network or to a VPN-reachable host. The user binds a host folder into the container as the media library root.

Recommended container paths:

- `/data/library`: bind-mounted media library root.
- `/data/app`: persistent app data, including SQLite database, browser session state, thumbnails, temporary job files, and logs.
- `/work`: temporary scratch space for active downloads and remux/transcode work.

The app may include Chromium/Playwright and `ffmpeg` in the container image. This is acceptable because reliability matters more than keeping the image minimal.

## Recommended Stack

Use a TypeScript modular monolith:

- Backend/API: Node.js with TypeScript.
- Frontend: TypeScript web UI, optimized for tablet and desktop.
- Browser automation: Playwright with Chromium.
- Database: SQLite in the persistent app data volume.
- Media tooling: `ffmpeg`/`ffprobe` for remuxing, compatibility conversion, duration/probe metadata, and thumbnail generation.
- Packaging: single Docker image plus a simple `docker-compose.yml` example.

Rust can be introduced later for isolated low-level download or media-processing components if the TypeScript implementation hits clear limits. It should not be part of the initial architecture unless there is a concrete reason.

## High-Level Architecture

The app is one deployable service with separate internal modules:

- Web UI: category navigation, add-link form, job queue, manual selection screen, video player, media actions.
- API layer: validates UI requests, exposes media/job/category endpoints, streams videos and thumbnails.
- SQLite storage: categories, media records, queue jobs, candidate sources, app settings.
- Queue runner: ensures only one active download job at a time and resumes unfinished work after restart.
- Browser analyzer: opens page URLs in a persistent browser context, captures network requests, detects media candidates, and supports manual selection.
- Download engine: downloads direct files, HLS playlists, DASH manifests, and selected segment streams without using site-specific downloader engines.
- Media processor: probes files, remuxes when possible, transcodes only when needed for browser compatibility, generates thumbnails.
- File manager: owns category folders, safe filenames, rename/move/delete operations, and temporary-to-final file promotion.

The application should keep these modules in separate source directories with narrow interfaces. The goal is a single deployable service without turning the code into one large mixed responsibility.

## Core User Flows

### Add A Link

1. User opens the app from a tablet or laptop.
2. User pastes a URL.
3. User selects an existing category or creates a new one.
4. User submits the job.
5. The job appears in the visible queue immediately.
6. If no other job is active, the queue runner starts it.

No metadata preview is required before submission. The system should start work first and ask for manual input only when needed.

### Automatic Download

1. The queue runner takes the next pending job.
2. The analyzer classifies the URL:
   - direct downloadable video file;
   - page URL with discoverable media requests;
   - HLS manifest;
   - DASH manifest;
   - unsupported or ambiguous page.
3. The downloader selects the highest available quality that it can reliably download.
4. The file is written to a temporary working path.
5. The media processor probes and normalizes the result.
6. The final file and thumbnail are moved into the selected category folder.
7. A media record is created, and the completed job no longer needs to appear as history.

### Manual Selection

If automatic detection cannot confidently choose a source, the job becomes `needs_manual_selection`.

The manual selection screen should provide:

- Original URL.
- Current category.
- A browser-assisted view of the target URL. Prefer an interactive controlled browser session when it can be safely exposed; otherwise show screenshots, page state, captured requests, and candidate media sources.
- Detected media candidates from network traffic, DOM video elements, manifests, and direct links.
- Candidate metadata when available: URL, content type, container, estimated size, resolution, duration, and confidence.
- A way to reload the page, interact with login/age gates in the browser session, and recapture candidates.
- A way to choose one candidate and resume the job.
- A way to replace the source URL with a more precise URL.
- Logs or structured diagnostic messages when no candidate is found.

The design should not rely on a normal iframe as the main mechanism because many sites block embedding. The implementation should use a browser automation layer and expose enough UI for the user to make a manual choice.

### Watch And Manage Video

From the category view, the user can:

- Play a video in the web interface.
- Rename a video.
- Move a video to another category.
- Delete a video.

Rename and move operations update both SQLite metadata and the actual file path on disk. Delete removes the media record, the video file, and its generated thumbnail.

## Categories And File Layout

Categories are flat. Each category maps to exactly one folder directly under the library root.

Example:

```text
/data/library/
  Category A/
    video-one.mp4
    video-two.mp4
  Category B/
    another-video.mp4
```

Rules:

- A video belongs to one category.
- Category names are sanitized for filesystem safety.
- Nested categories are not supported.
- Creating a category creates a folder.
- Renaming categories is outside this specification; the required category operations are listing, selecting, and creating categories.
- If a filename collision occurs, append a stable suffix such as `-2`, `-3`, or a short job id. Do not perform content deduplication.

Thumbnails and app metadata should not be mixed into category folders unless there is a strong implementation reason. Prefer `/data/app/thumbnails`.

## Data Model

Use SQLite with explicit migrations.

Core tables:

- `categories`: id, name, folder_name, created_at.
- `media_items`: id, category_id, title, filename, relative_path, thumbnail_path, duration_seconds, size_bytes, container, video_codec, audio_codec, source_url, created_at, updated_at.
- `download_jobs`: id, source_url, category_id, status, selected_candidate_id, title_hint, error_code, error_message, progress, created_at, updated_at, started_at, completed_at.
- `media_candidates`: id, job_id, kind, url, content_type, manifest_type, resolution, bitrate, duration_seconds, size_bytes, confidence, headers_json, discovered_at.
- `settings`: key, value.

Recommended job statuses:

- `pending`
- `analyzing`
- `needs_manual_selection`
- `downloading`
- `processing`
- `completed`
- `failed`
- `canceled`

Completed jobs can remain in SQLite for referential/debug purposes, but the UI does not need a history screen. The media library is the primary completed state.

## Download And Detection Pipeline

The pipeline is custom and source-agnostic. It should use general web/media mechanisms rather than per-site scraping plugins.

Detection inputs:

- URL extension and response headers for direct files.
- HTML `<video>` and `<source>` elements.
- Network requests captured during page load and playback.
- HLS manifests (`.m3u8`).
- DASH manifests (`.mpd`).
- Common media content types.
- Browser session cookies and headers from the controlled browser context when the user has manually logged in or accepted an age gate.

Download capabilities:

- Direct file download with resume support when the server supports ranges.
- HLS playlist download, highest-quality variant selection, segment download, and assembly.
- DASH manifest parsing, representation selection, segment download, and assembly.
- Header/cookie propagation from the browser context when required.
- Retry with bounded attempts for transient network failures.
- One active job at a time; all others wait in FIFO order unless the UI later adds manual reordering.

The downloader must not use `yt-dlp`, `youtube-dl`, or similar engines. Using `ffmpeg` as a low-level media tool is allowed.

## Media Normalization

The media processor should preserve quality whenever possible.

Preferred behavior:

1. If the downloaded file is already browser-friendly, keep it as-is.
2. If the streams are compatible but the container is inconvenient, remux without re-encoding.
3. If the file will not play reliably in target browsers, transcode to a browser-friendly MP4 profile.

Target playback compatibility should favor MP4/H.264/AAC when transcoding is required. The system should avoid unnecessary quality loss and should not claim to improve visual quality beyond the source. It can improve compatibility, container structure, and playback reliability.

Generate a thumbnail from the downloaded video itself. Do not depend on poster images from the source page.

## UI Requirements

The UI should be optimized for tablet and laptop/desktop use. Phone support can be responsive but is not the main design target.

Primary screens:

- Library/category view.
- Category detail view with video cards or rows.
- Add link flow with category select/create.
- Queue panel or queue page for pending/current/problem jobs.
- Manual selection screen.
- Video playback page/modal.
- Basic media edit/delete dialogs.

Navigation is category-first. No global search is required.

The queue should make active problems obvious:

- pending jobs;
- current job progress;
- failed jobs;
- jobs waiting for manual selection.

## Access And Security Boundaries

Supported access model:

- The app is reachable only on a trusted local network or through a user-managed VPN.
- No built-in login or password is required.
- Exposing the service directly to the public internet is unsupported.

Even without authentication, the backend should still implement basic safety boundaries:

- All filesystem operations stay under configured `/data/library` and `/data/app` roots.
- Category and file names are sanitized.
- URLs are treated as untrusted input.
- Private network SSRF protections are still desirable for future public exposure, but the initial supported model is trusted LAN/VPN.
- Browser automation state is local app state and should not be exposed through raw file-serving endpoints.

The project does not bypass DRM or extract protected media keys. If a browser can display a protected video only through a DRM pipeline, the app may detect that a protected stream exists but should mark it unsupported.

## Error Handling

Jobs should fail visibly and recoverably.

Failure cases:

- URL cannot be reached.
- Page loads but no media candidate is found.
- Multiple candidates exist and confidence is insufficient.
- Candidate requires manual login/age confirmation.
- Download fails after retries.
- Media processing fails.
- Disk space is insufficient.
- Output path cannot be written.
- Candidate is DRM-protected or encrypted in an unsupported way.

The UI should show a concise error message and retain enough diagnostic detail to understand what happened. Failed jobs should be retryable. Jobs needing manual choice should not be treated as failed.

## Testing And Verification

The project should include tests around the boundaries most likely to break:

- Category creation and filesystem-safe folder naming.
- Media rename, move, and delete operations.
- Queue state transitions and single-active-job behavior.
- Direct file download flow.
- HLS manifest parsing and highest-quality selection.
- DASH manifest parsing and representation selection.
- Candidate extraction from controlled test pages.
- Manual-selection job transitions.
- Media normalization decisions: keep, remux, transcode.
- Docker startup with mounted `/data/library` and `/data/app`.

End-to-end tests should use local fixture pages and local media files rather than depending on external websites. This keeps the test suite deterministic and avoids encoding site-specific behavior into core tests.

## Agent Guidance

Future agents should treat this document as the source of truth for product direction. The key architectural constraint is that the app intentionally avoids `yt-dlp` and instead builds a general browser/network/media pipeline. The key product constraint is that the app is personal and local, not a public multi-user downloader.

When implementing, prefer small modules with explicit interfaces:

- `categories`
- `media-library`
- `jobs`
- `browser-analyzer`
- `candidate-detection`
- `download-engine`
- `media-processing`
- `storage`
- `web-ui`

Do not introduce authentication, Postgres, nested categories, duplicate detection, global search, or public-internet assumptions unless the product specification is deliberately revised.

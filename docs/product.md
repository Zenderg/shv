# Product Contract

`shv` is a personal, self-hosted video library and downloader for a trusted home LAN or VPN.

This document is the product source of truth: supported scope, non-goals, user-facing behavior, and deployment assumptions. Put implementation structure in [docs/architecture.md](architecture.md), release procedure in [docs/releases.md](releases.md), and durable rationale in [docs/decisions.md](decisions.md). Historical implementation plans and one-off design notes should not be used as product specifications after their work has shipped.

## Scope

`shv` lets one trusted user:

- save video links into a local category-based library;
- add links from multiple personal devices on the same LAN or VPN;
- download direct video files, HLS streams, DASH streams, and selected browser-captured sources;
- discover media from page URLs where the final playable source is not visible until analysis or playback;
- use a Chromium helper extension when a page reveals playable media only during browser playback;
- choose one detected subtitle track, or choose no subtitles, before downloading a source that exposes subtitles;
- watch saved videos from the web UI;
- rename, move, and delete saved videos;
- inspect and recover queued, running, failed, canceled, and manual-selection jobs.

The supported deployment is one Docker Compose service with bind-mounted local storage. Application startup should stay Docker Compose based.

## Non-Goals

Do not add these without deliberately revising this product contract:

- public-internet deployment as a supported default;
- built-in accounts, passwords, roles, or multi-user authorization;
- nested categories;
- global search;
- duplicate detection or content deduplication;
- a completed-download history as the primary browsing surface;
- DRM bypass, key extraction, paywall bypass, or circumvention of protected media systems.

## Runtime Model

The container owns three persistent or working roots:

- `/data/library`: user-visible category folders and final media files.
- `/data/app`: SQLite database, thumbnails, browser profile state, manual-selection screenshots, diagnostics, extension cookies, and downloader cookies.
- `/work`: temporary active download and media-processing files.

The local `docker-compose.yml` mounts these from `./data/library`, `./data/app`, and `./data/work`.

## Downloading Contract

The default downloader is source-agnostic:

- classify direct video URLs and response headers;
- inspect HTML media tags and media links;
- capture browser network requests through Playwright and the Chromium extension;
- parse HLS and DASH manifests;
- choose the highest reliable representation it can download;
- resume direct file downloads when the server supports byte ranges;
- preserve browser request headers and selected cookies when the user explicitly chooses a source;
- preserve detected subtitle-track metadata through manual source selection and burn the user's chosen subtitle track into the saved video;
- remux when possible and transcode only when needed for browser playback.

Automatic download may proceed only when the submitted URL's direct probe identifies a confident media source. A redirect target reached by that probe is part of the submitted source. Media candidates discovered later through HTML inspection, Playwright network capture, or extension capture require manual source selection before download.

Site-specific engines are allowed only as explicit extractors for known complex platforms where generic replay is not reliable. YouTube currently uses `yt-dlp` behind the backend source-extractor boundary because some `googlevideo` playback URLs are bound to player/runtime details that cannot be replayed by the generic downloader. Do not route YouTube through extension-side file downloads.

Unsupported sources should fail visibly or ask for manual source selection. Manual selection can resume with a chosen candidate or replace the job source URL with a more precise URL. Unsupported sources should not silently fall back to DRM bypass, key extraction, or broad site-specific scraping.

## Browser Extension Contract

Manual source selection is extension-first. `Choose source` checks the expected local extension id, opens the source page in a normal browser tab, and injects an in-page Sources sidebar.

The extension should capture sources tied to active playback, not every media-looking request on the page. It may use a manual `Capture now` action for embedded players that stream media without exposing a usable DOM video element.

The extension reports detected subtitle tracks as source metadata. It does not try to decide which subtitle menu option
is currently selected inside an arbitrary source-page player. After `Use source`, if the selected candidate has supported
subtitle tracks, the main queue UI asks the user to choose one track or `No subtitles`. A chosen subtitle track is burned
into the final video so it displays by default in the app's normal HTML5 playback path.

The older Playwright live-browser screenshot endpoints remain backend diagnostics and fallback infrastructure. They are not the target production manual-selection UX.

Detailed extension behavior lives in [docs/browser-extension.md](browser-extension.md).

## Library Contract

Categories are flat and map to folders directly under `/data/library`. A video belongs to one category. Category creation is idempotent by sanitized display name. Category rename changes the display name and keeps the existing folder stable so saved media paths do not move.

Videos may have zero or more free-form labels. Labels describe videos rather than folders: moving a video to another
category preserves its labels, while each category derives its available label chips and exact counts from the saved
videos currently inside it. A label appears in a category when at least one saved video has it and disappears when the
last such assignment is removed. There is no empty-label catalog or separate label-creation flow.

The category label bar is a contextual, single-select server-side filter. `All` clears the filter; selecting a label
shows only matching videos and reports the filtered count against the full category total. Labels stay out of persistent
card metadata so the main browsing grid remains quiet. If an active label disappears, browsing returns to `All`.

Labels can be entered optionally while adding a link and can be replaced with any set while editing a saved video. The
category-scoped management dialog renames a label across that category or removes it from every video in that category.
Renaming to an existing label merges the assignments without duplicates. These batch operations do not change videos in
other categories and never delete video files. There is intentionally no standalone global label-management page.

Saved video files stay in human-readable category folders. If a filename collision occurs, append a stable suffix such as `-2`, `-3`, or a short job id rather than overwriting or deduplicating content.

Thumbnails and application metadata stay under `/data/app`, not mixed into category folders.

Deleting a category is cascading after explicit UI confirmation: saved media rows, category video files, thumbnails, and hidden completed job rows for that category are removed. Categories with visible queue jobs should return a conflict so active or problem work is not orphaned.

Saved media metadata must describe the final normalized file, not just the discovered source candidate.

Large categories load progressively as the user approaches the end of the visible library. The library still reports the
full category total, preserves newest-first ordering, and virtualizes card rows so the number of mounted video cards stays
bounded instead of growing with the category. Loading or retrying another page must not replace cards that are already
available.

## Queue Contract

The queue runs up to two active jobs by default; deployment may configure another bounded concurrency limit:

```text
pending -> analyzing -> downloading -> processing -> [adding_subtitles] -> completed
```

A job may also become `needs_manual_selection`, `needs_subtitle_selection`, `failed`, or `canceled`. `adding_subtitles`
appears only when the user selected a subtitle track.

The queue shows progress for the current active stage. It shows a percentage only when the source exposes enough
information to calculate one reliably; otherwise it shows an indeterminate active indicator. A missing percentage must
not make a healthy transfer look stalled or cause the backend to abort it while bytes or media timestamps are advancing.
The queue identifies the destination category and the current pipeline step, and separates active, waiting, attention,
and canceled counts instead of describing every visible row as queued work. A percentage is explicitly scoped to its
current step rather than presented as whole-job completion.

`needs_subtitle_selection` is a normal user-input state, not an error. It appears after source selection when the chosen
candidate has supported subtitle tracks. Continuing from that state either marks exactly one subtitle track selected or
marks all tracks unselected.

On server startup, interrupted active jobs are reset to `pending` so a Docker restart cannot leave work permanently stuck. Canceling or deleting a running job must abort the active browser analysis, direct download, ffmpeg process, thumbnail generation, and owned scratch files through the queue runner rather than only changing database state.

Optional labels chosen when a link is queued remain attached to that job across retries and restarts. They transfer
atomically to the saved video only when the job completes, so unfinished jobs do not create label chips in the library.
Category-scoped rename and removal also update visible jobs in that category so an old label cannot reappear when queued
work completes.

Completed jobs may remain in SQLite for referential/debug purposes, but the media library is the primary completed state.
When a completed job leaves the visible queue, the UI confirms where it was saved and offers to open that category.

Jobs should fail visibly and recoverably. Failure cases include unreachable URLs, no media candidates, ambiguous candidates, login or age gates, download failures, media-processing failures, disk or output-path errors, and DRM-protected or otherwise unsupported streams. Failed jobs should be retryable, and jobs waiting for manual choice should not be treated as failed.

## Safety Boundaries

Even in the trusted LAN/VPN model, the backend treats paths and URLs as untrusted input:

- all filesystem operations stay under configured `/data/library`, `/data/app`, and `/work` roots;
- category and file names are sanitized;
- source, candidate, and subtitle URLs that can reach browser navigation or downloading must use `http:` or `https:`, and downloader URLs must not contain embedded credentials;
- raw browser automation state is not exposed through generic file-serving endpoints.

Downloader network access follows the container's configured DNS and routing, including destinations on local or VPN-provided networks. This is intentional for the supported trusted deployment and must be reconsidered together with authentication and network controls before any future public or semi-public deployment model.

## Documentation Ownership

- [README.md](../README.md): entry point, safety notes, quick start, and doc index.
- [docs/product.md](product.md): product scope and source-of-truth behavior.
- [docs/decisions.md](decisions.md): durable rationale, rejected alternatives, and historical context.
- [docs/architecture.md](architecture.md): runtime architecture, module ownership, and cross-module contracts.
- [docs/browser-extension.md](browser-extension.md): extension installation, behavior, and diagnostics.
- [docs/browser-extension-debugging.md](browser-extension-debugging.md): agent-facing extension capture debugging playbook, evidence rules, and rejected approaches.
- [docs/development.md](development.md): local checks, seed data, screenshot workflow, and operational notes for contributors/agents.
- [docs/releases.md](releases.md): release and deployment workflow.

When implementation changes a documented contract, update the owning document in the same change. Avoid keeping completed implementation plans or temporary specs in `docs/`; they drift into false authority quickly.

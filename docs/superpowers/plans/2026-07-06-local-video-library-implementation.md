# Local Video Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production local video library and downloader described in `docs/superpowers/specs/2026-07-06-local-video-library-design.md`.

**Architecture:** A Dockerized TypeScript modular monolith serves a React web UI, JSON APIs, SQLite storage, a single-worker download queue, Playwright-based candidate discovery, ffmpeg-based media normalization, and safe filesystem-backed media management. Modules are split by product responsibility so later agents can improve one subsystem without unpacking the whole application.

**Tech Stack:** Node.js, TypeScript, Express, React, Vite, SQLite via `better-sqlite3`, Playwright Chromium, ffmpeg/ffprobe, Vitest, Docker Compose.

---

### Task 1: Project And Docker Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Modify: `README.md`

- [x] Define scripts for `build`, `test`, `typecheck`, `dev`, and production `start`.
- [x] Create a single container image that installs ffmpeg and Chromium.
- [x] Document Docker Compose as the supported application startup path.

### Task 2: Storage, Config, And Filesystem Safety

**Files:**
- Create: `src/server/config/appConfig.ts`
- Create: `src/server/storage/database.ts`
- Create: `src/server/storage/migrations.ts`
- Create: `src/server/utils/fileSafety.ts`
- Test: `tests/unit/fileSafety.test.ts`

- [x] Load configured roots from environment with `/data/library`, `/data/app`, and `/work` defaults.
- [x] Create explicit SQLite migrations for categories, media items, jobs, candidates, and settings.
- [x] Add path containment and safe filename helpers before implementing media operations.

### Task 3: Categories And Media Library

**Files:**
- Create: `src/server/categories/categoryService.ts`
- Create: `src/server/media-library/mediaLibraryService.ts`
- Create: `src/server/media-library/mediaFiles.ts`
- Test: `tests/unit/categoryService.test.ts`
- Test: `tests/unit/mediaLibraryService.test.ts`

- [x] Implement flat category creation with filesystem-safe folder names.
- [x] Implement list, rename media, move media, delete media, and read stream metadata.
- [x] Keep category folders human-readable and thumbnails under app data.

### Task 4: Jobs, Detection, Downloading, And Processing

**Files:**
- Create: `src/server/jobs/jobService.ts`
- Create: `src/server/jobs/queueRunner.ts`
- Create: `src/server/browser-analyzer/browserAnalyzer.ts`
- Create: `src/server/candidate-detection/candidateDetection.ts`
- Create: `src/server/download-engine/downloadEngine.ts`
- Create: `src/server/download-engine/hls.ts`
- Create: `src/server/download-engine/dash.ts`
- Create: `src/server/media-processing/mediaProcessor.ts`
- Test: `tests/unit/queueRunner.test.ts`
- Test: `tests/unit/hls.test.ts`
- Test: `tests/unit/dash.test.ts`
- Test: `tests/integration/directDownload.test.ts`

- [x] Persist queue state and enforce one active job at a time.
- [x] Detect direct files, HTML media tags, HLS manifests, DASH manifests, and captured browser requests.
- [x] Download direct files with range resume where available.
- [x] Download HLS and DASH through ffmpeg after selecting the highest reliable representation.
- [x] Probe, remux, transcode when required, and generate thumbnails.

### Task 5: API And Web UI

**Files:**
- Create: `src/server/api/routes.ts`
- Create: `src/server/index.ts`
- Create: `src/web/index.html`
- Create: `src/web/src/App.tsx`
- Create: `src/web/src/components/*.tsx`
- Create: `src/web/src/lib/api.ts`
- Create: `src/web/src/styles.css`

- [x] Expose category, media, job, candidate, thumbnail, and video streaming endpoints.
- [x] Build category-first UI with add-link, queue, manual selection, playback, rename, move, and delete flows.
- [x] Make the UI tablet and laptop friendly without adding unsupported auth, search, or nested categories.

### Task 6: Verification And Docs

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`

- [ ] Run typecheck, unit tests, integration tests, production build, and Docker Compose startup.
- [ ] Record any operational discoveries and known constraints for future agents.

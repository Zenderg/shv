# Dev Library Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fast local command that appends fake categories and media rows for UI development, plus a safe reset command for only that fake data.

**Architecture:** A focused dev script opens the local Compose-mounted database paths, reuses the existing category and media-library services, and writes tiny placeholder `.mp4` and optional thumbnail files. Reset identifies seeded media through the `dev-seed://` source URL scheme and seeded categories through the `[dev] ` display-name prefix.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, existing server services, npm scripts, Vitest.

---

### Task 1: Seed Module And Safety Test

**Files:**
- Create: `scripts/devLibrarySeed.ts`
- Test: `tests/unit/devLibrarySeed.test.ts`

- [x] Create exported `seedDevLibrary(options)` and `resetDevLibrary(options)` functions.
- [x] Default to `data/library`, `data/app`, and `data/work` under `process.cwd()`.
- [x] Reuse `openDatabase`, `CategoryService`, `MediaFiles`, and `MediaLibraryService`.
- [x] Generate deterministic edge-case category and media names.
- [x] Write tiny `.mp4` placeholder files and selected tiny `.jpg` thumbnail placeholders.
- [x] Delete only `dev-seed://` media rows and their owned files during reset.
- [x] Delete only empty categories whose names start with `[dev] ` during reset.
- [x] Add a unit test proving reset keeps non-seed media and categories.

### Task 2: CLI And npm Commands

**Files:**
- Modify: `scripts/devLibrarySeed.ts`
- Modify: `package.json`

- [x] Add CLI parsing for `seed` and `reset`.
- [x] Support `--categories <count>` and `--videos <count>` for the seed command.
- [x] Add `npm run dev:seed` and `npm run dev:seed:reset`.
- [x] Print concise counts for created and deleted categories/media.

### Task 3: Documentation And Verification

**Files:**
- Modify: `docs/development.md`

- [x] Document the seed and reset commands.
- [x] Explain that placeholder `.mp4` files are not playable video fixtures.
- [x] Run `npm test`, `npm run typecheck`, and `npm run build`.

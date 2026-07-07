# Active Source Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only source candidates tied to active video playback in the extension sidebar.

**Architecture:** The content script reports visible dominant video playback to the service worker. The service worker accepts network candidates only during a short active capture window and filters non-downloadable byte/chunk URLs before storing them.

**Tech Stack:** Chrome extension MV3, browser `webRequest`, vanilla JS content script, Vitest/typecheck/build verification.

---

### Task 1: Active Playback Signal

**Files:**
- Modify: `extension/chrome-source-helper/content-script.js`

- [x] Add video playback event listeners for `playing`, `timeupdate`, `loadedmetadata`, `pause`, and `ended`.
- [x] Report `SHV_ACTIVE_PLAYBACK` only for visible dominant video elements.
- [x] Send DOM candidates only from the active video element.

### Task 2: Active Network Gate

**Files:**
- Modify: `extension/chrome-source-helper/service-worker.js`
- Modify: `extension/chrome-source-helper/shared.js`
- Modify: `extension/chrome-source-helper/content-script.js`

- [x] Reject browser-local and `?bytes=` URLs in extension candidate detection.
- [x] Track `activeCaptureUntil` per session.
- [x] Accept `webRequest` candidates only while the active window is open.
- [x] Show sidebar status as waiting/listening/selected.
- [x] Add Capture now manual fallback for players that stream media without exposing a usable DOM `<video>`.

### Task 3: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Test: existing test suite and extension JS syntax checks.

- [x] Document active capture behavior.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and `node --check` for extension JS.

import { mount } from 'svelte';
import { APP_ORIGIN, candidateFromUrl, candidateFromVerifiedVideoUrl, PROTOCOL_VERSION } from '../../../extension/chrome-source-helper/shared.js';
import SourceSidebar from './SourceSidebar.svelte';
import { HIGHLIGHT_PADDING, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, sidebarCss } from './sidebarStyles';
import { setSidebarActions, sidebarView, type Candidate, type SourceSession } from './sidebarStore';

const PLAYBACK_SIGNAL_INTERVAL_MS = 1200;
const DIAGNOSTIC_SIGNAL_INTERVAL_MS = 1500;
const VIDEO_METADATA_TIMEOUT_MS = 8000;
const MAX_METADATA_PROBES_PER_SESSION = 6;
const VIDEO_METADATA_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v'];
const IS_TOP_FRAME = window.top === window;

type RuntimeMessage = Record<string, any>;

declare const chrome:
  | undefined
  | {
      runtime?: {
        id?: string;
        onMessage: {
          addListener: (
            callback: (message: RuntimeMessage, sender: unknown, sendResponse: (response: unknown) => void) => boolean
          ) => void;
        };
        sendMessage: (message: RuntimeMessage, callback?: (response: unknown) => void) => Promise<unknown> | void;
      };
    };

let sidebarHost: HTMLDivElement | null = null;
let sidebarShadow: ShadowRoot | null = null;
let sidebarTabId: number | null = null;
let sidebarVisible = false;
let sidebarCollapsed = false;
let renderTimer: number | null = null;
let renderSequence = 0;
let highlightOverlay: (HTMLDivElement & { candidate?: { kind: string; url: string }; target?: Element }) | null = null;
let highlightedCandidate: { kind: string; url: string } | null = null;
let activeVideoElement: HTMLVideoElement | null = null;
let lastPlaybackSignalAt = 0;
let lastDiagnosticSignalAt = 0;
let capturePending = false;
let selectionError: string | null = null;

const observedVideos = new WeakSet<HTMLVideoElement>();
const probingResolutionUrls = new Set<string>();
const resolutionUnavailableUrls = new Set<string>();
const selectingSourceUrls = new Set<string>();

registerVideoPlaybackListeners();
collectAndSendCandidates();
window.setInterval(() => {
  registerVideoPlaybackListeners();
  collectAndSendCandidates();
  sendPlaybackDiagnostics();
}, 1800);

const observer = new MutationObserver(() => {
  registerVideoPlaybackListeners();
  collectAndSendCandidates();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

chrome?.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
  if (!IS_TOP_FRAME) {
    return false;
  }
  if (message?.type === 'SHV_SOURCE_HELPER_PING') {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'SHV_SHOW_SIDEBAR') {
    sidebarTabId = message.tabId ?? sidebarTabId;
    showSidebar();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'SHV_TOGGLE_SIDEBAR') {
    sidebarTabId = message.tabId ?? sidebarTabId;
    if (sidebarVisible) {
      hideSidebar();
    } else {
      showSidebar();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'SHV_SOURCE_STATE_CHANGED') {
    sidebarTabId = message.tabId ?? sidebarTabId;
    if (sidebarVisible) {
      void renderSidebar();
    }
    return false;
  }
  if (message?.type === 'SHV_SOURCE_SELECTED') {
    window.postMessage(
      {
        channel: 'SHV_SOURCE_HELPER_EVENT',
        event: { jobId: message.jobId, type: 'source-selected' }
      },
      window.location.origin
    );
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

if (IS_TOP_FRAME) {
  window.addEventListener('message', (event) => {
    if (window.location.origin !== APP_ORIGIN || event.source !== window || event.data?.channel !== 'SHV_SOURCE_HELPER') {
      return;
    }
    if (event.data.extensionId && event.data.extensionId !== chrome?.runtime?.id) {
      return;
    }
    sendRuntimeMessage(event.data.message, (response) => {
      window.postMessage(
        {
          channel: 'SHV_SOURCE_HELPER_RESPONSE',
          extensionId: chrome?.runtime?.id,
          requestId: event.data.requestId,
          response
        },
        window.location.origin
      );
    });
  });
}

function showSidebar() {
  ensureSidebar();
  if (!sidebarHost) {
    return;
  }
  sidebarHost.style.display = 'block';
  sidebarHost.style.width = sidebarHostWidth(sidebarCollapsed);
  sidebarVisible = true;
  startRenderTimer();
  void renderSidebar();
}

function hideSidebar() {
  sidebarVisible = false;
  if (sidebarHost) {
    sidebarHost.style.display = 'none';
  }
  clearCandidateHighlight();
  stopRenderTimer();
}

function ensureSidebar() {
  if (sidebarHost && sidebarShadow) {
    return;
  }

  sidebarHost = document.createElement('div');
  sidebarHost.id = 'shv-source-helper-sidebar';
  sidebarHost.style.position = 'fixed';
  sidebarHost.style.top = '0';
  sidebarHost.style.right = '0';
  sidebarHost.style.bottom = '0';
  sidebarHost.style.width = sidebarHostWidth(false);
  sidebarHost.style.zIndex = '2147483647';
  sidebarHost.style.display = 'none';
  sidebarHost.style.pointerEvents = 'auto';

  sidebarShadow = sidebarHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = sidebarCss();
  sidebarShadow.append(style);
  mount(SourceSidebar, { target: sidebarShadow });
  setSidebarActions({
    clearHighlight: clearCandidateHighlight,
    close: hideSidebar,
    highlight: setCandidateHighlight,
    selectSource: (url) => {
      void selectSource(url);
    },
    startCapture: () => {
      void startManualCapture();
    },
    toggleCollapsed: () => {
      setSidebarCollapsed(!sidebarCollapsed);
    }
  });

  document.documentElement.append(sidebarHost);
}

function startRenderTimer() {
  if (renderTimer != null) {
    return;
  }
  renderTimer = window.setInterval(() => {
    if (sidebarVisible) {
      void renderSidebar();
    }
  }, 1500);
}

function stopRenderTimer() {
  if (renderTimer == null) {
    return;
  }
  window.clearInterval(renderTimer);
  renderTimer = null;
}

async function renderSidebar() {
  ensureSidebar();
  const sequence = ++renderSequence;
  const response = (await sendRuntimeMessage({ type: 'SHV_GET_PANEL_STATE' })) as { state?: { activeTabId: number | null; sessions: Record<string, SourceSession> } } | null;
  if (sequence !== renderSequence) {
    return;
  }
  const state = response?.state ?? { activeTabId: null, sessions: {} };
  const session = state.sessions[String(sidebarTabId ?? state.activeTabId ?? '')] ?? null;
  lastRenderedSession = session;

  if (session?.status === 'selected') {
    selectingSourceUrls.clear();
    selectionError = null;
  }
  updateSidebarView(session);
  if (highlightedCandidate) {
    updateHighlightOverlay();
  }
  void probeSessionCandidateMetadata(session);
}

function updateSidebarView(session: SourceSession | null) {
  sidebarView.set({
    capturePending,
    collapsed: sidebarCollapsed,
    highlightedUrl: highlightedCandidate?.url ?? null,
    probingResolutionUrls: [...probingResolutionUrls],
    resolutionUnavailableUrls: [...resolutionUnavailableUrls],
    selectingUrls: [...selectingSourceUrls],
    selectionError,
    session,
    status: session ? `${session.candidates.length} active / ${sessionDisplayStatus(session)}` : 'Open a source from shv'
  });
}

function setSidebarCollapsed(collapsed: boolean) {
  sidebarCollapsed = collapsed;
  if (sidebarHost) {
    sidebarHost.style.width = sidebarHostWidth(collapsed);
  }
  if (collapsed) {
    clearCandidateHighlight();
  }
  updateSidebarView(currentSidebarSession());
}

function sidebarHostWidth(collapsed: boolean) {
  return collapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : `min(100vw, ${SIDEBAR_WIDTH}px)`;
}

async function selectSource(url: string) {
  if (selectingSourceUrls.has(url)) {
    return;
  }
  selectionError = null;
  selectingSourceUrls.add(url);
  updateSidebarView(currentSidebarSession());
  try {
    const result = (await sendRuntimeMessage({
      tabId: sidebarTabId,
      type: 'SHV_SELECT_SOURCE',
      url
    })) as { error?: string; ok?: boolean } | null;
    if (result?.ok) {
      return;
    }
    selectionError = result?.error ?? 'Could not select that source. Try again from shv.';
  } catch {
    selectionError = 'Could not select that source. Try again from shv.';
  }
  selectingSourceUrls.delete(url);
  updateSidebarView(currentSidebarSession());
}

async function startManualCapture() {
  if (capturePending) {
    return;
  }
  selectionError = null;
  capturePending = true;
  updateSidebarView(currentSidebarSession());
  try {
    const result = (await sendRuntimeMessage({
      tabId: sidebarTabId,
      type: 'SHV_START_CAPTURE'
    })) as { error?: string; ok?: boolean } | null;
    if (result?.ok) {
      void renderSidebar();
      return;
    }
    selectionError = result?.error ?? 'Could not start capture. Try closing and reopening the Sources sidebar from shv.';
  } catch {
    selectionError = 'Could not start capture. Try closing and reopening the Sources sidebar from shv.';
  } finally {
    capturePending = false;
    updateSidebarView(currentSidebarSession());
  }
}

let lastRenderedSession: SourceSession | null = null;

function currentSidebarSession() {
  return lastRenderedSession;
}

function sessionDisplayStatus(session: SourceSession) {
  if (session.status === 'selected') {
    return 'selected';
  }
  const remainingSeconds = captureSecondsRemaining(session);
  return remainingSeconds > 0 ? `listening ${remainingSeconds}s` : 'waiting for playback';
}

function captureSecondsRemaining(session: SourceSession) {
  if (typeof session.activeCaptureUntil !== 'number') {
    return 0;
  }
  return Math.max(0, Math.ceil((session.activeCaptureUntil - Date.now()) / 1000));
}

function setCandidateHighlight(url: string) {
  const sessionCandidate = candidateFromSidebarUrl(url);
  if (!sessionCandidate) {
    clearCandidateHighlight();
    return;
  }
  highlightedCandidate = sessionCandidate;
  showHighlightOverlay(sessionCandidate);
  updateSidebarView(currentSidebarSession());
}

function candidateFromSidebarUrl(url: string) {
  const source = [...(sidebarShadow?.querySelectorAll('[data-highlight-source]') ?? [])].find(
    (element) => element instanceof HTMLElement && element.dataset.highlightSource === url
  );
  if (!(source instanceof HTMLElement)) {
    return null;
  }
  return { kind: source.dataset.highlightKind ?? 'source', url };
}

function clearCandidateHighlight() {
  highlightedCandidate = null;
  if (highlightOverlay) {
    highlightOverlay.style.display = 'none';
  }
  updateSidebarView(currentSidebarSession());
}

function showHighlightOverlay(candidate: { kind: string; url: string }) {
  const target = findVisualTarget(candidate);
  ensureHighlightOverlay();
  if (!highlightOverlay) {
    return;
  }
  if (!target) {
    highlightOverlay.style.display = 'none';
    return;
  }
  highlightOverlay.target = target;
  highlightOverlay.candidate = candidate;
  updateHighlightOverlay();
}

function ensureHighlightOverlay() {
  if (highlightOverlay) {
    return;
  }
  highlightOverlay = document.createElement('div') as HTMLDivElement & { candidate?: { kind: string; url: string }; target?: Element };
  highlightOverlay.id = 'shv-source-helper-highlight';
  highlightOverlay.style.position = 'fixed';
  highlightOverlay.style.display = 'none';
  highlightOverlay.style.pointerEvents = 'none';
  highlightOverlay.style.zIndex = '2147483646';
  highlightOverlay.innerHTML = '<span></span>';
  document.documentElement.append(highlightOverlay);
  window.addEventListener('scroll', updateHighlightOverlay, true);
  window.addEventListener('resize', updateHighlightOverlay);
}

function updateHighlightOverlay() {
  if (!highlightOverlay?.target || !highlightedCandidate) {
    return;
  }
  const rect = highlightOverlay.target.getBoundingClientRect();
  if (!isVisibleRect(rect)) {
    highlightOverlay.style.display = 'none';
    return;
  }
  const left = Math.max(HIGHLIGHT_PADDING, rect.left - HIGHLIGHT_PADDING);
  const top = Math.max(HIGHLIGHT_PADDING, rect.top - HIGHLIGHT_PADDING);
  const rightLimit = window.innerWidth - sidebarReservedWidth() - HIGHLIGHT_PADDING;
  const width = Math.max(48, Math.min(rect.width + HIGHLIGHT_PADDING * 2, rightLimit - left));
  const height = Math.max(48, Math.min(rect.height + HIGHLIGHT_PADDING * 2, window.innerHeight - top - HIGHLIGHT_PADDING));
  highlightOverlay.style.cssText = `
    position: fixed;
    display: block;
    pointer-events: none;
    z-index: 2147483646;
    left: ${left}px;
    top: ${top}px;
    width: ${width}px;
    height: ${height}px;
    border: 3px solid #23d18b;
    border-radius: 14px;
    background: rgba(35, 209, 139, 0.12);
    box-shadow: 0 0 0 9999px rgba(6, 12, 10, 0.18), 0 0 0 6px rgba(35, 209, 139, 0.18);
  `;
  const label = highlightOverlay.querySelector('span');
  if (!label) {
    return;
  }
  label.textContent = `${highlightedCandidate.kind} source`;
  label.setAttribute(
    'style',
    `
      background: #1e6f55;
      border-radius: 999px;
      color: #ffffff;
      font: 800 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      left: 12px;
      max-width: calc(100% - 24px);
      overflow: hidden;
      padding: 8px 10px;
      position: absolute;
      text-overflow: ellipsis;
      top: 12px;
      white-space: nowrap;
    `
  );
}

function findVisualTarget(candidate: { url: string }) {
  const exact = findExactUrlElement(candidate.url);
  return exact ?? findDominantVideoTarget();
}

function findExactUrlElement(url: string) {
  for (const element of document.querySelectorAll('video, source, a')) {
    const directUrl = element.getAttribute('src') || element.getAttribute('href');
    const currentUrl = element instanceof HTMLMediaElement ? element.currentSrc || element.src : null;
    if (sameUrl(url, directUrl) || sameUrl(url, currentUrl)) {
      return preferredHighlightElement(element);
    }
  }
  return null;
}

function findDominantVideoTarget() {
  const candidates = largeVisibleVideoEntries();
  if (candidates.length === 0) {
    return null;
  }
  const [largest, next] = candidates;
  if (next && rectArea(largest.rect) < rectArea(next.rect) * 2) {
    return null;
  }
  return largest.element;
}

function dominantVideoElement() {
  const candidates = largeVisibleVideoEntries();
  if (candidates.length === 0) {
    return null;
  }
  const [largest, next] = candidates;
  if (next && rectArea(largest.rect) < rectArea(next.rect) * 2) {
    return null;
  }
  return largest.video;
}

function largeVisibleVideoEntries() {
  const reservedWidth = IS_TOP_FRAME ? sidebarReservedWidth() : 0;
  const viewportArea = Math.max(1, (window.innerWidth - reservedWidth) * window.innerHeight);
  const minimumArea = Math.min(160000, viewportArea * 0.08);
  return [...document.querySelectorAll('video')]
    .map((video) => {
      const element = preferredHighlightElement(video);
      return element ? { element, rect: element.getBoundingClientRect(), video } : null;
    })
    .filter((entry): entry is { element: Element; rect: DOMRect; video: HTMLVideoElement } => Boolean(entry))
    .filter(({ rect }) => isVisibleRect(rect))
    .filter(({ rect }) => rect.width >= 320 && rect.height >= 180 && rectArea(rect) >= minimumArea)
    .sort((left, right) => rectArea(right.rect) - rectArea(left.rect));
}

function preferredHighlightElement(element: Element) {
  let best = element instanceof HTMLSourceElement && element.parentElement ? element.parentElement : element;
  let current = best.parentElement;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
    if (current === sidebarHost || current.id === 'shv-source-helper-highlight') {
      break;
    }
    const bestRect = best.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    if (!isVisibleRect(currentRect)) {
      continue;
    }
    const bestArea = rectArea(bestRect);
    const currentArea = rectArea(currentRect);
    if (currentArea > bestArea && currentArea <= Math.max(bestArea * 5, bestArea + 180000)) {
      best = current;
    }
  }
  return best;
}

function sameUrl(left: string | null, right: string | null) {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left, window.location.href).href === new URL(right, window.location.href).href;
  } catch {
    return left === right;
  }
}

function isVisibleRect(rect: DOMRect) {
  return rect.width >= 24 && rect.height >= 24 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function rectArea(rect: DOMRect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function registerVideoPlaybackListeners() {
  for (const video of document.querySelectorAll('video')) {
    if (observedVideos.has(video)) {
      continue;
    }
    observedVideos.add(video);
    for (const eventName of ['playing', 'timeupdate', 'loadedmetadata']) {
      video.addEventListener(eventName, () => handleVideoActivity(video), { passive: true });
    }
    for (const eventName of ['pause', 'ended']) {
      video.addEventListener(
        eventName,
        () => {
          if (activeVideoElement === video) {
            collectAndSendCandidates();
          }
        },
        { passive: true }
      );
    }
  }
}

function handleVideoActivity(video: HTMLVideoElement) {
  if (!isActivePlaybackVideo(video)) {
    return;
  }
  activeVideoElement = video;
  collectAndSendCandidates();
}

function isActivePlaybackVideo(video: HTMLVideoElement) {
  return video instanceof HTMLVideoElement && !video.paused && !video.ended && dominantVideoElement() === video;
}

function collectAndSendCandidates() {
  const activeVideo = activeVideoElement && isActivePlaybackVideo(activeVideoElement) ? activeVideoElement : dominantVideoElement();
  if (!activeVideo || !isActivePlaybackVideo(activeVideo)) {
    return;
  }
  const now = Date.now();
  if (now - lastPlaybackSignalAt < PLAYBACK_SIGNAL_INTERVAL_MS) {
    return;
  }
  lastPlaybackSignalAt = now;

  const candidates = activeVideoCandidates(activeVideo);
  void sendRuntimeMessage({
    candidates,
    currentSrc: activeVideo.currentSrc || activeVideo.src || null,
    playbackMetadata: videoElementMetadata(activeVideo),
    protocolVersion: PROTOCOL_VERSION,
    type: 'SHV_ACTIVE_PLAYBACK'
  });
}

function sendPlaybackDiagnostics() {
  const now = Date.now();
  if (now - lastDiagnosticSignalAt < DIAGNOSTIC_SIGNAL_INTERVAL_MS) {
    return;
  }
  lastDiagnosticSignalAt = now;
  void sendRuntimeMessage({
    diagnostic: playbackDiagnostic(),
    protocolVersion: PROTOCOL_VERSION,
    type: 'SHV_PLAYBACK_DIAGNOSTIC'
  });
}

function sendRuntimeMessage(message: RuntimeMessage, callback?: (response: unknown) => void) {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      callback?.(null);
      return Promise.resolve(null);
    }
    const result = chrome.runtime.sendMessage(message, callback);
    return callback ? Promise.resolve(null) : Promise.resolve(result).catch(() => null);
  } catch {
    callback?.(null);
    return Promise.resolve(null);
  }
}

function playbackDiagnostic() {
  const videos = [...document.querySelectorAll('video')];
  const largeVisibleEntries = largeVisibleVideoEntries();
  const dominant = dominantVideoElement();
  const active = activeVideoElement && isActivePlaybackVideo(activeVideoElement) ? activeVideoElement : null;
  return {
    activeFound: Boolean(active),
    dominantFound: Boolean(dominant),
    frameUrl: window.location.href,
    isTopFrame: IS_TOP_FRAME,
    largeVisibleCount: largeVisibleEntries.length,
    sentAt: new Date().toISOString(),
    videoCount: videos.length,
    videos: videos.slice(0, 3).map((video) => {
      const rect = video.getBoundingClientRect();
      return {
        currentSrcKind: urlKind(video.currentSrc),
        currentTime: Number.isFinite(video.currentTime) ? Math.round(video.currentTime) : null,
        ended: video.ended,
        height: Math.round(rect.height),
        paused: video.paused,
        readyState: video.readyState,
        srcKind: urlKind(video.src),
        width: Math.round(rect.width)
      };
    })
  };
}

function urlKind(value: string) {
  if (!value) {
    return 'empty';
  }
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol === 'blob:') {
      return 'blob';
    }
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return 'invalid';
  }
}

function activeVideoCandidates(video: HTMLVideoElement) {
  const candidates = [];
  const urls = new Set<string>();
  const metadata = videoElementMetadata(video);
  for (const rawUrl of [
    video.currentSrc,
    video.src,
    ...[...video.querySelectorAll('source')].map((source) => source.src || source.getAttribute('src'))
  ]) {
    if (!rawUrl || urls.has(rawUrl)) {
      continue;
    }
    urls.add(rawUrl);
    const candidate =
      candidateFromUrl(rawUrl, null, 'html-video', window.location.href) ??
      (metadata.resolution ? candidateFromVerifiedVideoUrl(rawUrl, 'html-video', window.location.href) : null);
    if (candidate) {
      candidate.durationSeconds = metadata.durationSeconds;
      candidate.resolution = metadata.resolution;
      candidates.push(candidate);
    }
  }
  return candidates;
}

function probeSessionCandidateMetadata(session: SourceSession | null) {
  if (!IS_TOP_FRAME || !session) {
    return;
  }
  let started = 0;
  for (const candidate of session.candidates) {
    if (started >= MAX_METADATA_PROBES_PER_SESSION || probingResolutionUrls.size >= MAX_METADATA_PROBES_PER_SESSION) {
      return;
    }
    if (!shouldProbeCandidateResolution(candidate)) {
      continue;
    }
    started += 1;
    void probeCandidateResolution(candidate);
  }
}

function shouldProbeCandidateResolution(candidate: Candidate) {
  if (
    candidate.resolution ||
    candidate.manifestType ||
    probingResolutionUrls.has(candidate.url) ||
    resolutionUnavailableUrls.has(candidate.url)
  ) {
    return false;
  }
  const contentType = normalizedContentType(candidate.contentType);
  if (contentType?.startsWith('audio/')) {
    return false;
  }
  if (contentType?.startsWith('video/')) {
    return true;
  }
  if (candidate.kind !== 'browser-request' && candidate.kind !== 'html-video') {
    return false;
  }
  return hasVideoUrlHint(candidate.url);
}

async function probeCandidateResolution(candidate: Candidate) {
  probingResolutionUrls.add(candidate.url);
  resolutionUnavailableUrls.delete(candidate.url);
  updateSidebarView(currentSidebarSession());
  const probe = await loadVideoMetadata(candidate.url);
  probingResolutionUrls.delete(candidate.url);
  if (!probe.resolution) {
    resolutionUnavailableUrls.add(candidate.url);
    sendDebugEvent(candidate, {
      details: {
        contentType: candidate.contentType,
        kind: candidate.kind,
        mediaErrorCode: probe.mediaErrorCode,
        manifestType: candidate.manifestType
      },
      eventType: 'metadata-probe',
      reason: probe.reason,
      status: 'unavailable'
    });
    updateSidebarView(currentSidebarSession());
    return;
  }
  resolutionUnavailableUrls.delete(candidate.url);
  const result = (await sendRuntimeMessage({
    candidates: [
      {
        ...candidate,
        durationSeconds: probe.durationSeconds ?? candidate.durationSeconds,
        resolution: probe.resolution
      }
    ],
    type: 'SHV_CANDIDATE_METADATA'
  })) as { ok?: boolean } | null;
  if (!result?.ok) {
    resolutionUnavailableUrls.add(candidate.url);
  }
  sendDebugEvent(candidate, {
    details: {
      contentType: candidate.contentType,
      durationSeconds: probe.durationSeconds,
      kind: candidate.kind,
      manifestType: candidate.manifestType,
      resolution: probe.resolution
    },
    eventType: 'metadata-probe',
    reason: result?.ok ? null : 'metadata-post-failed',
    status: result?.ok ? 'available' : 'unavailable'
  });
  updateSidebarView(currentSidebarSession());
}

function loadVideoMetadata(url: string) {
  return new Promise<{ durationSeconds: number | null; mediaErrorCode: number | null; reason: string; resolution: string | null }>((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (metadata: { durationSeconds: number | null; mediaErrorCode: number | null; reason: string; resolution: string | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      video.remove();
      resolve(metadata);
    };
    const timeout = window.setTimeout(() => finish({ durationSeconds: null, mediaErrorCode: null, reason: 'metadata-timeout', resolution: null }), VIDEO_METADATA_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', () => finish({ ...videoElementMetadata(video), mediaErrorCode: null, reason: 'loadedmetadata' }), { once: true });
    video.addEventListener('error', () => finish({ durationSeconds: null, mediaErrorCode: video.error?.code ?? null, reason: 'video-error', resolution: null }), { once: true });
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.style.cssText = 'height:1px;left:-9999px;opacity:0;pointer-events:none;position:fixed;top:-9999px;width:1px;';
    document.documentElement.append(video);
    video.src = url;
    video.load();
  });
}

function sendDebugEvent(candidate: Candidate, event: { details?: Record<string, unknown>; eventType: string; reason: string | null; status: string }) {
  const session = currentSidebarSession();
  void sendRuntimeMessage({
    event: {
      candidateUrl: candidate.url,
      details: {
        frameUrl: window.location.href,
        isTopFrame: IS_TOP_FRAME,
        ...(event.details ?? {})
      },
      eventType: event.eventType,
      frameUrl: window.location.href,
      jobId: session?.jobId ?? null,
      reason: event.reason,
      status: event.status
    },
    type: 'SHV_DEBUG_EVENT'
  });
}

function videoElementMetadata(video: HTMLVideoElement) {
  const width = Math.round(video.videoWidth);
  const height = Math.round(video.videoHeight);
  return {
    durationSeconds: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
    resolution: width > 0 && height > 0 ? `${width}x${height}` : null
  };
}

function normalizedContentType(value: string | null) {
  return value?.split(';')[0].trim().toLowerCase() ?? null;
}

function hasVideoUrlHint(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    const mime = normalizedContentType(parsed.searchParams.get('mime'));
    return (
      Boolean(mime?.startsWith('video/')) ||
      VIDEO_METADATA_EXTENSIONS.some((extension) => parsed.pathname.toLowerCase().endsWith(extension)) ||
      (parsed.hostname.endsWith('.googlevideo.com') && parsed.pathname.endsWith('/videoplayback'))
    );
  } catch {
    return false;
  }
}

function sidebarReservedWidth() {
  return sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : Math.min(window.innerWidth, SIDEBAR_WIDTH);
}

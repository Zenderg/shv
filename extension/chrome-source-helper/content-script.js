const PROTOCOL_VERSION = 1;
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'];
const SIDEBAR_WIDTH = 390;
const HIGHLIGHT_PADDING = 8;
const PLAYBACK_SIGNAL_INTERVAL_MS = 1200;
const DIAGNOSTIC_SIGNAL_INTERVAL_MS = 1500;
const IS_TOP_FRAME = window.top === window;

let sidebarHost = null;
let sidebarShadow = null;
let sidebarTabId = null;
let sidebarVisible = false;
let renderTimer = null;
let renderSequence = 0;
let highlightOverlay = null;
let highlightedCandidate = null;
let activeVideoElement = null;
let lastPlaybackSignalAt = 0;
let lastDiagnosticSignalAt = 0;

const observedVideos = new WeakSet();
const selectingSourceUrls = new Set();

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!IS_TOP_FRAME) {
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
    if (event.source !== window || event.data?.channel !== 'SHV_SOURCE_HELPER') {
      return;
    }
    chrome.runtime.sendMessage(event.data.message, (response) => {
      window.postMessage(
        {
          channel: 'SHV_SOURCE_HELPER_RESPONSE',
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
  sidebarHost.style.display = 'block';
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
  sidebarHost.style.width = `${SIDEBAR_WIDTH}px`;
  sidebarHost.style.zIndex = '2147483647';
  sidebarHost.style.display = 'none';
  sidebarHost.style.pointerEvents = 'auto';

  sidebarShadow = sidebarHost.attachShadow({ mode: 'open' });
  sidebarShadow.innerHTML = `
    <style>${sidebarCss()}</style>
    <aside class="panel" aria-label="shv sources">
      <header>
        <div>
          <h1>Sources</h1>
          <p id="shv-status">Opening...</p>
        </div>
        <button class="icon-button" id="shv-close" type="button" aria-label="Close sources">x</button>
      </header>
      <section id="shv-job"></section>
      <section id="shv-sources" class="sources"></section>
    </aside>
  `;
  sidebarShadow.getElementById('shv-close').addEventListener('click', hideSidebar);
  sidebarShadow.addEventListener('mouseover', (event) => {
    const source = event.target instanceof Element ? event.target.closest('[data-highlight-source]') : null;
    if (source instanceof HTMLElement && source.dataset.highlightSource) {
      setCandidateHighlight(source.dataset.highlightSource, source);
    }
  });
  sidebarShadow.addEventListener('mouseout', (event) => {
    const source = event.target instanceof Element ? event.target.closest('[data-highlight-source]') : null;
    if (!(source instanceof HTMLElement) || source.contains(event.relatedTarget)) {
      return;
    }
    clearCandidateHighlight();
  });
  sidebarShadow.addEventListener('focusin', (event) => {
    const source = event.target instanceof Element ? event.target.closest('[data-highlight-source]') : null;
    if (source instanceof HTMLElement && source.dataset.highlightSource) {
      setCandidateHighlight(source.dataset.highlightSource, source);
    }
  });
  sidebarShadow.addEventListener('focusout', (event) => {
    const source = event.target instanceof Element ? event.target.closest('[data-highlight-source]') : null;
    if (!(source instanceof HTMLElement) || source.contains(event.relatedTarget)) {
      return;
    }
    clearCandidateHighlight();
  });
  sidebarShadow.addEventListener('click', (event) => {
    const captureButton = event.target instanceof Element ? event.target.closest('[data-start-capture]') : null;
    if (captureButton instanceof HTMLButtonElement) {
      void startManualCapture(captureButton);
      return;
    }

    const button = event.target instanceof Element ? event.target.closest('[data-use-source]') : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const url = button.dataset.useSource;
    if (url) {
      void selectSource(url, button);
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
  const response = await chrome.runtime.sendMessage({ type: 'SHV_GET_PANEL_STATE' });
  if (sequence !== renderSequence) {
    return;
  }
  const state = response?.state ?? { activeTabId: null, sessions: {} };
  const session = state.sessions[String(sidebarTabId ?? state.activeTabId ?? '')] ?? latestSession(state.sessions);
  const status = sidebarShadow.getElementById('shv-status');
  const job = sidebarShadow.getElementById('shv-job');
  const sources = sidebarShadow.getElementById('shv-sources');

  if (!session) {
    status.textContent = 'Open a source from shv';
    job.innerHTML = '';
    renderEmptySources(sources, '<strong>No active job.</strong><p>Go back to shv and click Choose source.</p>');
    return;
  }

  const captureActive = isCaptureActive(session);
  status.textContent = `${session.candidates.length} active / ${sessionDisplayStatus(session)}`;
  job.innerHTML = `
    <div class="job">
      <strong>${escapeHtml(session.titleHint || hostname(session.sourceUrl))}</strong>
      <span>${escapeHtml(session.sourceUrl)}</span>
      ${
        session.status === 'selected'
          ? ''
          : captureButtonHtml(session)
      }
    </div>
  `;
  if (session.candidates.length === 0) {
    renderEmptySources(
      sources,
      captureActive
        ? '<strong>Listening for media sources...</strong><p>Keep the video playing or seek so the player makes a fresh media request.</p>'
        : '<strong>No active media sources yet.</strong><p>Start the main video, then use Capture now if the player is embedded or hidden from the page.</p>',
      diagnosticsHtml(session, true)
    );
    return;
  }

  renderCandidateSources(sources, session);
  if (highlightedCandidate) {
    updateHighlightOverlay();
  }
}

function renderEmptySources(sources, emptyHtml, diagnostics = '') {
  for (const article of sources.querySelectorAll('[data-source-card]')) {
    article.remove();
  }
  ensureSourceEmpty(sources).innerHTML = emptyHtml;
  renderDiagnostics(sources, diagnostics);
}

function renderCandidateSources(sources, session) {
  ensureSourceEmpty(sources).remove();
  const diagnostics = ensureSourceDiagnostics(sources);
  const selected = session.status === 'selected';
  if (selected) {
    selectingSourceUrls.clear();
  }
  const existingArticles = new Map(
    [...sources.querySelectorAll('[data-source-card]')]
      .filter((article) => article instanceof HTMLElement)
      .map((article) => [article.dataset.sourceUrl, article])
  );

  for (const candidate of session.candidates) {
    const article = existingArticles.get(candidate.url) ?? createSourceArticle();
    updateSourceArticle(article, candidate, selected);
    sources.insertBefore(article, diagnostics);
    existingArticles.delete(candidate.url);
  }
  for (const article of existingArticles.values()) {
    article.remove();
  }
  renderDiagnostics(sources, diagnosticsHtml(session, false));
}

function createSourceArticle() {
  const article = document.createElement('article');
  article.className = 'source';
  article.dataset.sourceCard = 'true';
  article.innerHTML = `
    <div class="source-top">
      <strong data-source-kind></strong>
      <span data-source-confidence></span>
    </div>
    <p data-source-type></p>
    <code data-source-url></code>
    <button data-use-source type="button"></button>
  `;
  return article;
}

function updateSourceArticle(article, candidate, selected) {
  const isSelecting = selectingSourceUrls.has(candidate.url);
  article.dataset.sourceUrl = candidate.url;
  article.dataset.highlightKind = candidate.kind;
  article.dataset.highlightSource = candidate.url;
  article.classList.toggle('is-highlighted', highlightedCandidate?.url === candidate.url);
  article.querySelector('[data-source-kind]').textContent = candidate.kind;
  article.querySelector('[data-source-confidence]').textContent = `${Math.round(candidate.confidence * 100)}%`;
  article.querySelector('[data-source-type]').textContent = candidate.contentType ?? candidate.manifestType ?? 'unknown type';
  article.querySelector('[data-source-url]').textContent = candidate.url;

  const button = article.querySelector('[data-use-source]');
  button.dataset.useSource = candidate.url;
  button.disabled = selected || isSelecting;
  button.textContent = selected ? 'Selected' : isSelecting ? 'Selecting...' : 'Use source';
}

function ensureSourceEmpty(sources) {
  let empty = sources.querySelector('[data-source-empty]');
  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'empty';
    empty.dataset.sourceEmpty = 'true';
    sources.prepend(empty);
  }
  return empty;
}

function ensureSourceDiagnostics(sources) {
  let diagnostics = sources.querySelector('[data-source-diagnostics]');
  if (!diagnostics) {
    diagnostics = document.createElement('div');
    diagnostics.dataset.sourceDiagnostics = 'true';
    sources.append(diagnostics);
  }
  return diagnostics;
}

function renderDiagnostics(sources, html) {
  const diagnostics = ensureSourceDiagnostics(sources);
  diagnostics.innerHTML = html;
  if (!html) {
    diagnostics.remove();
  }
}

async function selectSource(url, button) {
  if (selectingSourceUrls.has(url)) {
    return;
  }
  selectingSourceUrls.add(url);
  button.disabled = true;
  button.textContent = 'Selecting...';
  try {
    const result = await chrome.runtime.sendMessage({
      tabId: sidebarTabId,
      type: 'SHV_SELECT_SOURCE',
      url
    });
    button.textContent = result?.ok ? 'Selected' : 'Selection failed';
    if (result?.ok) {
      return;
    }
  } catch {
    button.textContent = 'Selection failed';
  }
  selectingSourceUrls.delete(url);
  if (button.isConnected) {
    button.disabled = false;
  }
}

async function startManualCapture(button) {
  button.disabled = true;
  button.textContent = 'Capturing...';
  try {
    const result = await chrome.runtime.sendMessage({
      tabId: sidebarTabId,
      type: 'SHV_START_CAPTURE'
    });
    button.textContent = result?.ok ? 'Listening...' : 'Capture failed';
    button.disabled = false;
    if (!result?.ok) {
      return;
    }
    void renderSidebar();
  } catch {
    button.textContent = 'Capture failed';
    button.disabled = false;
  }
}

function setCandidateHighlight(url, sourceElement) {
  const sessionCandidate = candidateFromSidebarUrl(url);
  if (!sessionCandidate) {
    clearCandidateHighlight();
    return;
  }
  highlightedCandidate = sessionCandidate;
  markHighlightedSource(sourceElement);
  showHighlightOverlay(sessionCandidate);
}

function candidateFromSidebarUrl(url) {
  const sources = [...sidebarShadow.querySelectorAll('[data-highlight-source]')];
  const card = sources.find((source) => source instanceof HTMLElement && source.dataset.highlightSource === url);
  const kind = card instanceof HTMLElement ? card.dataset.highlightKind ?? 'source' : 'source';
  return { kind, url };
}

function markHighlightedSource(sourceElement) {
  for (const source of sidebarShadow.querySelectorAll('.source.is-highlighted')) {
    source.classList.remove('is-highlighted');
  }
  sourceElement.classList.add('is-highlighted');
}

function clearCandidateHighlight() {
  highlightedCandidate = null;
  for (const source of sidebarShadow?.querySelectorAll('.source.is-highlighted') ?? []) {
    source.classList.remove('is-highlighted');
  }
  if (highlightOverlay) {
    highlightOverlay.style.display = 'none';
  }
}

function showHighlightOverlay(candidate) {
  const target = findVisualTarget(candidate);
  ensureHighlightOverlay();
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
  highlightOverlay = document.createElement('div');
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
  const rightLimit = window.innerWidth - SIDEBAR_WIDTH - HIGHLIGHT_PADDING;
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
  label.textContent = `${highlightedCandidate.kind} source`;
  label.style.cssText = `
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
  `;
}

function findVisualTarget(candidate) {
  const exact = findExactUrlElement(candidate.url);
  if (exact) {
    return exact;
  }
  return findDominantVideoTarget();
}

function findExactUrlElement(url) {
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
  const reservedWidth = IS_TOP_FRAME ? SIDEBAR_WIDTH : 0;
  const viewportArea = Math.max(1, (window.innerWidth - reservedWidth) * window.innerHeight);
  const minimumArea = Math.min(160000, viewportArea * 0.08);
  return [...document.querySelectorAll('video')]
    .map((video) => {
      const element = preferredHighlightElement(video);
      return element ? { element, rect: element.getBoundingClientRect(), video } : null;
    })
    .filter(Boolean)
    .filter(({ rect }) => isVisibleRect(rect))
    .filter(({ rect }) => rect.width >= 320 && rect.height >= 180 && rectArea(rect) >= minimumArea)
    .sort((left, right) => rectArea(right.rect) - rectArea(left.rect));
}

function preferredHighlightElement(element) {
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

function sameUrl(left, right) {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left, window.location.href).href === new URL(right, window.location.href).href;
  } catch {
    return left === right;
  }
}

function isVisibleRect(rect) {
  return rect.width >= 24 && rect.height >= 24 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function rectArea(rect) {
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
      video.addEventListener(eventName, () => {
        if (activeVideoElement === video) {
          collectAndSendCandidates();
        }
      }, { passive: true });
    }
  }
}

function handleVideoActivity(video) {
  if (!isActivePlaybackVideo(video)) {
    return;
  }
  activeVideoElement = video;
  collectAndSendCandidates();
}

function isActivePlaybackVideo(video) {
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
  chrome.runtime.sendMessage({
    candidates,
    currentSrc: activeVideo.currentSrc || activeVideo.src || null,
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
  Promise.resolve(chrome.runtime.sendMessage({
    diagnostic: playbackDiagnostic(),
    protocolVersion: PROTOCOL_VERSION,
    type: 'SHV_PLAYBACK_DIAGNOSTIC'
  })).catch(() => undefined);
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

function urlKind(value) {
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

function activeVideoCandidates(video) {
  const candidates = [];
  const urls = new Set();
  for (const rawUrl of [video.currentSrc, video.src, ...[...video.querySelectorAll('source')].map((source) => source.src || source.getAttribute('src'))]) {
    if (!rawUrl || urls.has(rawUrl)) {
      continue;
    }
    urls.add(rawUrl);
    const candidate = candidateFromUrl(new URL(rawUrl, window.location.href).href, null, 'html-video');
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function candidateFromUrl(url, contentType = null, kindOverride = null) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isServerDownloadableUrl(parsed)) {
    return null;
  }
  if (isYoutubeSabrTransport(parsed, contentType)) {
    return null;
  }

  const pathname = parsed.pathname.toLowerCase();
  const normalizedContentType = normalizedContentTypeFor(parsed, contentType);
  if (normalizedContentType?.includes('mpegurl') || pathname.endsWith('.m3u8')) {
    return candidate('hls', parsed.href, normalizedContentType ?? 'application/vnd.apple.mpegurl', 'hls', 0.92);
  }
  if (normalizedContentType === 'application/dash+xml' || pathname.endsWith('.mpd')) {
    return candidate('dash', parsed.href, normalizedContentType ?? 'application/dash+xml', 'dash', 0.9);
  }
  if (normalizedContentType?.startsWith('video/') || VIDEO_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
    return candidate(kindOverride ?? 'browser-request', parsed.href, normalizedContentType, null, normalizedContentType ? 0.86 : 0.7);
  }
  if (isGoogleVideoPlaybackUrl(parsed)) {
    return candidate(kindOverride ?? 'browser-request', parsed.href, normalizedContentType, null, 0.76);
  }
  return null;
}

function normalizedContentTypeFor(parsed, contentType) {
  const queryMime = normalizeContentType(parsed.searchParams.get('mime'));
  if (queryMime?.startsWith('video/') || queryMime?.startsWith('audio/') || queryMime?.includes('mpegurl')) {
    return queryMime;
  }
  return normalizeContentType(contentType) ?? queryMime;
}

function normalizeContentType(value) {
  const normalized = value?.split(';')[0].trim().toLowerCase() ?? null;
  if (!normalized?.includes('/')) {
    return null;
  }
  return normalized;
}

function isServerDownloadableUrl(parsed) {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return !parsed.searchParams.has('bytes') && !parsed.searchParams.has('range');
}

function isGoogleVideoPlaybackUrl(parsed) {
  return parsed.hostname.endsWith('.googlevideo.com') && parsed.pathname.endsWith('/videoplayback');
}

function isYoutubeSabrTransport(parsed, contentType) {
  return isGoogleVideoPlaybackUrl(parsed) && parsed.searchParams.get('sabr') === '1';
}

function candidate(kind, url, contentType, manifestType, confidence) {
  return {
    bitrate: null,
    confidence,
    contentType,
    durationSeconds: null,
    headers: {},
    kind,
    manifestType,
    resolution: null,
    sizeBytes: null,
    url
  };
}

function latestSession(sessions) {
  return Object.values(sessions ?? {}).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0] ?? null;
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sessionDisplayStatus(session) {
  if (session.status === 'selected') {
    return 'selected';
  }
  const remainingSeconds = captureSecondsRemaining(session);
  if (remainingSeconds > 0) {
    return `listening ${remainingSeconds}s`;
  }
  return 'waiting for playback';
}

function captureButtonHtml(session) {
  const remainingSeconds = captureSecondsRemaining(session);
  if (remainingSeconds <= 0) {
    return '<button class="capture-button" data-start-capture type="button">Capture now</button>';
  }
  return `<button class="capture-button" data-start-capture disabled type="button">Listening... ${remainingSeconds}s</button>`;
}

function isCaptureActive(session) {
  return captureSecondsRemaining(session) > 0;
}

function captureSecondsRemaining(session) {
  if (typeof session.activeCaptureUntil !== 'number') {
    return 0;
  }
  return Math.max(0, Math.ceil((session.activeCaptureUntil - Date.now()) / 1000));
}

function diagnosticsHtml(session, _open) {
  const diagnostics = session.diagnostics ?? {};
  const playback = diagnostics.playback ?? null;
  const network = diagnostics.network ?? {};
  const firstVideo = playback?.videos?.[0] ?? null;
  const rows = [
    ['videos', playback ? `${playback.videoCount} total / ${playback.largeVisibleCount} large` : 'no signal yet'],
    ['dominant', playback ? yesNo(playback.dominantFound) : 'unknown'],
    ['active', playback ? yesNo(playback.activeFound) : 'unknown'],
    ['first video', firstVideo ? `${firstVideo.width}x${firstVideo.height}, paused ${yesNo(firstVideo.paused)}, ready ${firstVideo.readyState}, src ${firstVideo.currentSrcKind}` : 'none'],
    ['network seen', String(network.observed ?? 0)],
    ['classified', String(network.classified ?? 0)],
    ['mapped', String(network.mapped ?? 0)],
    ['unmapped', String(network.unmapped ?? 0)],
    ['last network', network.lastReason ?? 'none'],
    ['reject', network.lastRejectReason ?? 'none'],
    ['last host', network.lastHost ?? 'none'],
    ['request headers', network.lastHeaderKeys ?? 'none'],
    ['status/type', network.lastStatusCode != null ? `${network.lastStatusCode} / ${network.lastType ?? 'unknown'}` : 'none'],
    ['path', network.lastPath ?? 'none'],
    ['query keys', network.lastQueryKeys ?? 'none']
  ];
  return `
    <section class="diagnostics" aria-label="Capture diagnostics">
      <strong>Diagnostics</strong>
      ${rows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></p>`).join('')}
    </section>
  `;
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function sidebarCss() {
  return `
    :host {
      all: initial;
      color: #17211d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .panel {
      background: #f8faf6;
      border-left: 1px solid rgba(23, 33, 29, 0.12);
      box-shadow: -14px 0 32px rgba(15, 23, 42, 0.18);
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
      overflow: hidden;
      width: ${SIDEBAR_WIDTH}px;
    }

    header {
      align-items: start;
      background: #ffffff;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 18px 16px 14px;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      color: #17211d;
      font-size: 28px;
      letter-spacing: 0;
      line-height: 1;
    }

    header p,
    .job span,
    .source p,
    .empty p {
      color: #64716b;
    }

    .icon-button {
      align-items: center;
      background: #edf2ee;
      border: 0;
      border-radius: 999px;
      color: #17211d;
      cursor: pointer;
      display: inline-flex;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .job {
      background: #ffffff;
      border-top: 1px solid rgba(23, 33, 29, 0.08);
      display: grid;
      gap: 7px;
      padding: 12px 16px;
    }

    .job strong,
    .job span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .capture-button {
      background: #21362e;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 34px;
    }

    .capture-button:disabled {
      cursor: progress;
      opacity: 0.7;
    }

    .sources {
      display: grid;
      gap: 10px;
      overflow: auto;
      padding: 12px;
    }

    .source {
      background: #ffffff;
      border-radius: 8px;
      display: grid;
      gap: 8px;
      padding: 12px;
      transition: box-shadow 120ms ease, transform 120ms ease;
    }

    .source.is-highlighted {
      box-shadow: inset 0 0 0 2px #23d18b, 0 8px 22px rgba(30, 111, 85, 0.16);
      transform: translateX(-2px);
    }

    .source-top {
      align-items: center;
      display: flex;
      justify-content: space-between;
    }

    .source-top strong {
      color: #17211d;
      font-size: 14px;
    }

    .source-top span {
      background: #e7f4de;
      border-radius: 999px;
      color: #24593f;
      font-size: 12px;
      font-weight: 800;
      padding: 5px 7px;
    }

    .source p {
      font-size: 12px;
    }

    .source code {
      color: #44524b;
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      max-height: 82px;
      overflow: auto;
      overflow-wrap: anywhere;
    }

    .source button {
      background: #1e6f55;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 40px;
    }

    .source button:disabled {
      cursor: not-allowed;
      opacity: 0.62;
    }

    .empty {
      background: #fff7ed;
      color: #7c2d12;
      display: grid;
      gap: 8px;
      padding: 14px;
    }

    .empty p {
      color: #8c4a24;
      font-size: 13px;
    }

    .diagnostics {
      background: #eef5ff;
      color: #19324d;
      display: grid;
      gap: 6px;
      padding: 12px;
    }

    .diagnostics strong {
      font-size: 13px;
    }

    .diagnostics p {
      align-items: start;
      display: grid;
      gap: 6px;
      grid-template-columns: 92px 1fr;
      margin: 0;
    }

    .diagnostics span {
      color: #4b6178;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .diagnostics code {
      color: #19324d;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }

    @media (max-width: 720px) {
      .panel {
        width: min(100vw, ${SIDEBAR_WIDTH}px);
      }
    }
  `;
}

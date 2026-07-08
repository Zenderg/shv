import {
  APP_ORIGIN,
  EXTENSION_VERSION,
  PROTOCOL_VERSION,
  candidateFromUrl,
  candidateRejectionReason,
  mergeCandidates,
  parseHlsManifestMetadata,
  sessionTabIdsForRequest,
  subtitleTrackFromUrl
} from './shared.js';

const ACTIVE_CAPTURE_WINDOW_MS = 30000;
const ACTIVE_PLAYBACK_WINDOW_MS = 5000;
const PENDING_NETWORK_BUFFER_MS = 15000;
const pendingNetworkCandidatesByTab = new Map();
const pendingSubtitleTracksByTab = new Map();
const hlsMetadataByTab = new Map();
const hlsManifestFetches = new Set();
const requestHeadersByRequestId = new Map();
let stateWriteChain = Promise.resolve();
const DOWNLOAD_HEADER_NAMES = new Set([
  'accept',
  'accept-language',
  'origin',
  'referer',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'user-agent'
]);
const HLS_MANIFEST_FETCH_HEADER_NAMES = new Set(['accept', 'accept-language']);

chrome.action.onClicked.addListener(() => {
  void toggleActiveTabSidebar();
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SHV_HELLO') {
    if (!isAppUrl(sender?.url)) {
      sendResponse({ appOrigin: APP_ORIGIN, installed: false });
      return false;
    }
    sendResponse({ appOrigin: APP_ORIGIN, installed: true, protocolVersion: PROTOCOL_VERSION, version: EXTENSION_VERSION });
    return false;
  }

  if (message?.type === 'SHV_OPEN_SOURCE') {
    if (!isAppUrl(sender?.url)) {
      sendResponse({ ok: false, error: 'Source tabs can only be opened by the shv app page' });
      return false;
    }
    openSourceTab(message, sender).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  return false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SHV_HELLO') {
    sendResponse({ installed: true, protocolVersion: PROTOCOL_VERSION, version: EXTENSION_VERSION });
    return false;
  }
  if (message?.type === 'SHV_OPEN_SOURCE') {
    openSourceTab(message, sender).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_PAGE_CANDIDATES' && sender.tab?.id != null) {
    mergeTabCandidates(sender.tab.id, message.candidates ?? []).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_ACTIVE_PLAYBACK' && sender.tab?.id != null) {
    activatePlaybackCapture(sender.tab.id, message.candidates ?? [], message.playbackMetadata, message.currentSrc, message.subtitleTracks ?? []).then((result) => {
      sendResponse(result);
      void postExtensionDebugEvent({
        details: {
          candidateCount: message.candidates?.length ?? 0,
          currentSrc: message.currentSrc ?? null,
          playbackMetadata: normalizePlaybackMetadata(message.playbackMetadata, message.currentSrc),
          subtitleTrackCount: message.subtitleTracks?.length ?? 0
        },
        eventType: 'active-playback',
        reason: message.playbackMetadata?.resolution ? null : 'missing-active-video-resolution',
        status: message.playbackMetadata?.resolution ? 'available' : 'unavailable',
        tabId: sender.tab?.id ?? null
      }).catch(() => undefined);
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_PLAYBACK_INACTIVE' && sender.tab?.id != null) {
    deactivatePlaybackCapture(sender.tab.id, message.currentSrc).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_PLAYBACK_DIAGNOSTIC' && sender.tab?.id != null) {
    updatePlaybackDiagnostics(sender.tab.id, message.diagnostic).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_CANDIDATE_METADATA' && sender.tab?.id != null) {
    mergeTabCandidates(sender.tab.id, message.candidates ?? [], { requireActive: false }).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_DEBUG_EVENT') {
    postExtensionDebugEvent({ ...(message.event ?? {}), tabId: sender.tab?.id ?? message.event?.tabId ?? null }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_START_CAPTURE') {
    Promise.resolve().then(() => startManualCapture(sourceTabIdForRuntimeCommand(message, sender))).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_GET_PANEL_STATE') {
    panelState().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  if (message?.type === 'SHV_SELECT_SOURCE') {
    Promise.resolve().then(() => selectSource(sourceTabIdForRuntimeCommand(message, sender), message.url)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }
  return false;
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const requestHeaders = requestHeadersByRequestId.get(details.requestId) ?? {};
    void recordNetworkDetails(details, requestHeaders).finally(() => {
      requestHeadersByRequestId.delete(details.requestId);
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = downloadableRequestHeaders(details.requestHeaders ?? []);
    if (Object.keys(headers).length > 0) {
      requestHeadersByRequestId.set(details.requestId, headers);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    requestHeadersByRequestId.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    requestHeadersByRequestId.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

chrome.webNavigation?.onCommitted.addListener((details) => {
  void injectContentScriptIntoCommittedFrame(details);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabSession(tabId);
});

async function openSourceTab(message, sender) {
  assertOpenSourceMessage(message);
  const appTabId = await resolveAppTabId(sender);
  const tab = await chrome.tabs.create({ active: true, url: message.sourceUrl });
  if (tab.id == null) {
    throw new Error('Chrome did not return a tab id');
  }

  await upsertState((state) => {
    state.activeTabId = tab.id;
    state.sessions[String(tab.id)] = {
      candidates: [],
      appTabId,
      activeCaptureUntil: null,
      currentUrl: message.sourceUrl,
      diagnostics: emptyDiagnostics(),
      jobId: message.jobId,
      playbackState: null,
      selectedUrl: null,
      sourceUrl: message.sourceUrl,
      status: 'waiting for playback',
      subtitleTracks: [],
      titleHint: message.titleHint ?? null,
      updatedAt: new Date().toISOString()
    };
  });

  await showSidebarInTab(tab.id);
  notifyPanel(tab.id);
  return { ok: true, tabId: tab.id };
}

async function activatePlaybackCapture(tabId, candidates, playbackMetadata = null, currentSrc = null, subtitleTracks = []) {
  return openCaptureWindow(tabId, candidates, playbackMetadata, currentSrc, subtitleTracks);
}

async function startManualCapture(tabId) {
  if (tabId == null) {
    throw new Error('No source tab available for capture');
  }
  return openCaptureWindow(tabId, []);
}

async function openCaptureWindow(tabId, candidates, playbackMetadata = null, currentSrc = null, subtitleTracks = []) {
  const now = Date.now();
  const activeCaptureUntil = now + ACTIVE_CAPTURE_WINDOW_MS;
  const activePlaybackUntil = now + ACTIVE_PLAYBACK_WINDOW_MS;
  const pendingCandidates = takePendingNetworkCandidates(tabId, now);
  const pendingSubtitleTracks = takePendingSubtitleTracks(tabId, now);
  const mergedSubtitleTracks = mergeSubtitleTracks(pendingSubtitleTracks, subtitleTracks);
  let session = null;
  const normalizedPlaybackMetadata = normalizePlaybackMetadata(playbackMetadata, currentSrc);
  const hasPlaybackSignal = playbackMetadata != null || currentSrc != null;

  await upsertState((state) => {
    session = state.sessions[String(tabId)];
    if (!session) {
      return;
    }
    session.activeCaptureUntil = activeCaptureUntil;
    if (hasPlaybackSignal) {
      session.activePlaybackUntil = activePlaybackUntil;
      session.playbackState = 'active';
    } else if (session.playbackState !== 'inactive') {
      session.activePlaybackUntil = null;
      session.playbackState = null;
    }
    if (normalizedPlaybackMetadata) {
      session.activePlaybackMetadata = normalizedPlaybackMetadata;
    }
    session.subtitleTracks = mergeSubtitleTracks(session.subtitleTracks ?? [], mergedSubtitleTracks);
    session.status = 'listening';
    session.updatedAt = new Date().toISOString();
  });

  if (!session) {
    return { ok: true };
  }

  await mergeTabCandidates(tabId, attachSubtitleTracksToCandidates([...pendingCandidates, ...candidates], mergedSubtitleTracks), { requireActive: false });
  notifyPanel(tabId);
  return { captured: pendingCandidates.length + candidates.length, ok: true };
}

async function deactivatePlaybackCapture(tabId, currentSrc = null) {
  const normalizedCurrentSrc = normalizedHttpUrl(currentSrc);
  let changed = false;
  await upsertState((state) => {
    const session = state.sessions[String(tabId)];
    if (!session || session.status === 'selected') {
      return;
    }
    const activeCurrentSrc = session.activePlaybackMetadata?.currentSrc ?? null;
    if (normalizedCurrentSrc && activeCurrentSrc && !sameUrl(normalizedCurrentSrc, activeCurrentSrc)) {
      return;
    }
    session.activeCaptureUntil = null;
    session.activePlaybackUntil = null;
    session.playbackState = 'inactive';
    session.status = 'waiting for playback';
    session.updatedAt = new Date().toISOString();
    changed = true;
  });
  if (changed) {
    notifyPanel(tabId);
  }
  return { ok: true };
}

async function resolveAppTabId(sender) {
  if (sender?.tab?.id != null) {
    return sender.tab.id;
  }
  if (!isAppUrl(sender?.url)) {
    return null;
  }
  const tabs = await chrome.tabs.query({ url: [`${APP_ORIGIN}/*`] }).catch(() => []);
  const exact = tabs.find((tab) => tab.url === sender.url);
  return exact?.id ?? tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id ?? null;
}

function isAppUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function sourceTabIdForRuntimeCommand(message, sender) {
  const senderTabId = sender?.tab?.id ?? null;
  if (isAppUrl(sender?.url)) {
    return message.tabId ?? senderTabId;
  }
  if (senderTabId == null) {
    return message.tabId ?? null;
  }
  if (message.tabId != null && message.tabId !== senderTabId) {
    throw new Error('Source tabs cannot act on a different tab session');
  }
  return senderTabId;
}

async function toggleActiveTabSidebar() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) {
    return;
  }
  await ensureContentScriptInTab(tab.id).catch(() => undefined);
  await sendTabMessage(tab.id, { tabId: tab.id, type: 'SHV_TOGGLE_SIDEBAR' }).catch(() => undefined);
}

async function showSidebarInTab(tabId) {
  await ensureContentScriptInTab(tabId);
  await retryTabMessage(tabId, { tabId, type: 'SHV_SHOW_SIDEBAR' });
}

async function injectContentScriptIntoCommittedFrame(details) {
  if (!isInjectableSourceFrameNavigation(details)) {
    return;
  }
  const state = await getState();
  if (!state.sessions[String(details.tabId)]) {
    return;
  }
  if (details.frameId === 0) {
    await upsertState((nextState) => {
      const session = nextState.sessions[String(details.tabId)];
      if (!session) {
        return;
      }
      session.currentUrl = details.url;
      session.updatedAt = new Date().toISOString();
    });
    await showSidebarInTab(details.tabId).catch(() => undefined);
    notifyPanel(details.tabId);
    return;
  }
  await chrome.scripting.executeScript({
    files: ['content-script.js'],
    target: { frameIds: [details.frameId], tabId: details.tabId }
  }).catch(() => undefined);
}

function isInjectableSourceFrameNavigation(details) {
  if (!Number.isInteger(details?.tabId) || details.tabId < 0 || !Number.isInteger(details?.frameId) || details.frameId < 0) {
    return false;
  }
  return isHttpUrl(details.url);
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function ensureContentScriptInTab(tabId) {
  const existing = await sendTabMessage(tabId, { type: 'SHV_SOURCE_HELPER_PING' }).catch(() => null);
  if (existing?.ok) {
    return;
  }
  await chrome.scripting.executeScript({
    files: ['content-script.js'],
    target: { allFrames: true, tabId }
  });
}

async function retryTabMessage(tabId, message) {
  let lastError = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    try {
      return await sendTabMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError ?? new Error('The source sidebar did not become ready');
}

function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function recordNetworkDetails(details, requestHeaders = {}) {
  const contentType = headerValue(details.responseHeaders ?? [], 'content-type');
  const candidate = candidateFromUrl(details.url, contentType, 'browser-request');
  const subtitleTrack = subtitleTrackFromUrl(details.url, contentType, 'network');
  const state = await getState();
  const tabIds = sessionTabIdsForRequest(details, state);
  const diagnostic = networkDiagnosticFor(details, contentType, candidate, requestHeaders);
  if (diagnostic && tabIds.length > 0) {
    for (const tabId of tabIds) {
      await updateNetworkDiagnostics(tabId, diagnostic, {
        classified: Boolean(candidate),
        mapped: true,
        unmapped: false
      });
    }
  } else if (diagnostic) {
    for (const tabId of activeDiagnosticTabIds(state)) {
      await updateNetworkDiagnostics(tabId, { ...diagnostic, reason: 'media-like request was not mapped to a source tab' }, {
        classified: Boolean(candidate),
        mapped: false,
        unmapped: true
      });
    }
  }
  if (!candidate) {
    if (subtitleTrack) {
      subtitleTrack.headers = requestHeaders;
      for (const tabId of tabIds) {
        await recordNetworkSubtitleTrack(tabId, subtitleTrack);
        void postExtensionDebugEvent({
          candidateUrl: subtitleTrack.url,
          details: {
            contentType,
            headerKeys: Object.keys(requestHeaders).sort(),
            initiator: details.initiator ?? details.documentUrl ?? null,
            requestType: details.type ?? 'unknown',
            statusCode: details.statusCode ?? null
          },
          eventType: 'network-subtitle-track',
          reason: null,
          status: 'captured',
          tabId
        }).catch(() => undefined);
      }
    }
    return;
  }
  candidate.headers = requestHeaders;
  for (const tabId of tabIds) {
    const candidateForTab = enrichCandidateWithKnownHlsMetadata(tabId, candidate);
    await recordNetworkCandidate(tabId, candidateForTab);
    void inspectHlsManifestCandidate(tabId, candidateForTab).catch(() => undefined);
    void postExtensionDebugEvent({
      candidateUrl: candidateForTab.url,
      details: {
        contentType,
        headerKeys: Object.keys(requestHeaders).sort(),
        initiator: details.initiator ?? details.documentUrl ?? null,
        requestType: details.type ?? 'unknown',
        statusCode: details.statusCode ?? null
      },
      eventType: 'network-candidate',
      reason: null,
      status: 'captured',
      tabId
    }).catch(() => undefined);
  }
}

async function updatePlaybackDiagnostics(tabId, diagnostic) {
  await upsertState((state) => {
    const session = state.sessions[String(tabId)];
    if (!session) {
      return;
    }
    session.diagnostics ??= emptyDiagnostics();
    session.diagnostics.playback = betterPlaybackDiagnostic(session.diagnostics.playback, diagnostic);
    session.currentUrl = currentUrlFromPlaybackDiagnostic(session.diagnostics.playback) ?? session.currentUrl;
    session.updatedAt = new Date().toISOString();
  });
  notifyPanel(tabId);
  return { ok: true };
}

async function updateNetworkDiagnostics(tabId, diagnostic, flags) {
  await upsertState((state) => {
    const session = state.sessions[String(tabId)];
    if (!session) {
      return;
    }
    session.diagnostics ??= emptyDiagnostics();
    session.diagnostics.network ??= {};
    const network = session.diagnostics.network;
    network.observed = (network.observed ?? 0) + 1;
    network.classified = (network.classified ?? 0) + (flags.classified ? 1 : 0);
    network.mapped = (network.mapped ?? 0) + (flags.mapped ? 1 : 0);
    network.unmapped = (network.unmapped ?? 0) + (flags.unmapped ? 1 : 0);
    network.lastAt = new Date().toISOString();
    network.lastContentType = diagnostic.contentType;
    network.lastHost = diagnostic.host;
    network.lastPath = diagnostic.path;
    network.lastQueryKeys = diagnostic.queryKeys;
    network.lastRejectReason = diagnostic.rejectReason;
    network.lastReason = diagnostic.reason;
    network.lastStatusCode = diagnostic.statusCode;
    network.lastTabId = diagnostic.tabId;
    network.lastType = diagnostic.type;
    network.lastInitiator = diagnostic.initiator;
    network.lastHeaderKeys = diagnostic.headerKeys;
    session.updatedAt = new Date().toISOString();
  });
  notifyPanel(tabId);
}

function emptyDiagnostics() {
  return {
    network: {
      classified: 0,
      mapped: 0,
      observed: 0,
      unmapped: 0
    },
    playback: null
  };
}

function networkDiagnosticFor(details, contentType, candidate, requestHeaders = {}) {
  let parsed = null;
  try {
    parsed = new URL(details.url);
  } catch {
    return null;
  }
  const normalizedContentType = contentType ? contentType.split(';')[0].trim().toLowerCase() : null;
  const hasVideoMimeQuery = parsed.searchParams.get('mime')?.toLowerCase().startsWith('video/');
  const isMediaLike =
    Boolean(candidate) ||
    parsed.hostname.includes('googlevideo') ||
    parsed.pathname.includes('videoplayback') ||
    normalizedContentType?.startsWith('video/') ||
    normalizedContentType?.startsWith('audio/') ||
    hasVideoMimeQuery;
  if (!isMediaLike) {
    return null;
  }
  return {
    contentType: normalizedContentType ?? parsed.searchParams.get('mime') ?? 'unknown',
    headerKeys: Object.keys(requestHeaders).sort().join(', ') || 'none',
    host: parsed.hostname,
    initiator: details.initiator ?? details.documentUrl ?? null,
    path: parsed.pathname,
    queryKeys: [...parsed.searchParams.keys()].slice(0, 16).join(', ') || 'none',
    rejectReason: candidate ? 'accepted' : candidateRejectionReason(details.url, contentType),
    reason: candidate ? 'classified as candidate' : 'media-like request rejected by classifier',
    statusCode: details.statusCode ?? null,
    tabId: details.tabId,
    type: details.type ?? 'unknown'
  };
}

function activeDiagnosticTabIds(state) {
  const activeTabId = Number(state?.activeTabId);
  if (Number.isInteger(activeTabId) && isSessionCaptureActive(state?.sessions?.[String(activeTabId)])) {
    return [activeTabId];
  }

  const activeSessions = Object.entries(state?.sessions ?? {})
    .filter(([, session]) => isSessionCaptureActive(session))
    .map(([tabId]) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  return activeSessions.length === 1 ? activeSessions : [];
}

function betterPlaybackDiagnostic(current, incoming) {
  if (!incoming) {
    return current ?? null;
  }
  if (!current) {
    return incoming;
  }
  const currentScore = playbackDiagnosticScore(current);
  const incomingScore = playbackDiagnosticScore(incoming);
  if (incomingScore >= currentScore) {
    return incoming;
  }
  const currentAt = Date.parse(current.sentAt ?? '') || 0;
  const incomingAt = Date.parse(incoming.sentAt ?? '') || 0;
  return incomingAt - currentAt > 5000 ? incoming : current;
}

function currentUrlFromPlaybackDiagnostic(diagnostic) {
  try {
    const parsed = new URL(diagnostic?.frameUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Ignore missing or browser-internal frame URLs.
  }
  return null;
}

function playbackDiagnosticScore(diagnostic) {
  return (
    (diagnostic.activeFound ? 100 : 0) +
    (diagnostic.dominantFound ? 20 : 0) +
    Math.min(10, diagnostic.largeVisibleCount ?? 0) +
    Math.min(5, diagnostic.videoCount ?? 0)
  );
}

async function recordNetworkCandidate(tabId, candidate) {
  rememberPendingNetworkCandidate(tabId, candidate);
  await mergeTabCandidates(tabId, [candidate], { requireActive: true });
}

async function recordNetworkSubtitleTrack(tabId, track) {
  const detectedTrack = { ...track, isSelected: track.isSelected ?? null };
  rememberPendingSubtitleTrack(tabId, detectedTrack);
  let session = null;
  let changed = false;
  await upsertState((state) => {
    session = state.sessions[String(tabId)];
    if (!session || !isSessionCaptureActive(session)) {
      return;
    }
    const subtitleTracks = mergeSubtitleTracks(session.subtitleTracks ?? [], [detectedTrack]);
    changed = JSON.stringify(subtitleTracks) !== JSON.stringify(session.subtitleTracks ?? []);
    if (!changed) {
      return;
    }
    session.subtitleTracks = subtitleTracks;
    session.candidates = attachSubtitleTracksToCandidates(session.candidates ?? [], subtitleTracks);
    session.updatedAt = new Date().toISOString();
  });

  if (session && changed) {
    await postCandidates(session.jobId, session.candidates);
    notifyPanel(tabId);
  }
}

async function mergeTabCandidates(tabId, candidates, options = {}) {
  const normalized = candidates.filter(Boolean);
  if (normalized.length === 0) {
    return { ok: true };
  }

  let session = null;
  await upsertState((state) => {
    session = state.sessions[String(tabId)];
    if (!session) {
      return;
    }
    if (options.requireActive && !isSessionCaptureActive(session)) {
      return;
    }
    const withKnownHlsMetadata = normalized.map((candidate) => enrichCandidateWithKnownHlsMetadata(tabId, candidate));
    const withSessionSubtitles = attachSubtitleTracksToCandidates(withKnownHlsMetadata, session.subtitleTracks ?? []);
    session.candidates = mergeCandidates(
      session.candidates,
      enrichCandidatesWithPlaybackMetadata(withSessionSubtitles, session.activePlaybackMetadata)
    );
    session.updatedAt = new Date().toISOString();
  });

  if (session && (!options.requireActive || isSessionCaptureActive(session))) {
    await postCandidates(session.jobId, session.candidates);
    notifyPanel(tabId);
  }
  return { ok: true };
}

function rememberPendingNetworkCandidate(tabId, candidate) {
  const now = Date.now();
  const pending = pendingNetworkCandidatesByTab.get(tabId) ?? [];
  pending.push({ candidate, capturedAt: now });
  pendingNetworkCandidatesByTab.set(
    tabId,
    pending.filter((entry) => now - entry.capturedAt <= PENDING_NETWORK_BUFFER_MS).slice(-80)
  );
}

function rememberPendingSubtitleTrack(tabId, track) {
  const now = Date.now();
  const pending = pendingSubtitleTracksByTab.get(tabId) ?? [];
  pending.push({ track, capturedAt: now });
  pendingSubtitleTracksByTab.set(
    tabId,
    pending.filter((entry) => now - entry.capturedAt <= PENDING_NETWORK_BUFFER_MS).slice(-80)
  );
}

function takePendingNetworkCandidates(tabId, now = Date.now()) {
  const pending = pendingNetworkCandidatesByTab.get(tabId) ?? [];
  const fresh = pending.filter((entry) => now - entry.capturedAt <= PENDING_NETWORK_BUFFER_MS).map((entry) => entry.candidate);
  pendingNetworkCandidatesByTab.delete(tabId);
  return fresh;
}

function takePendingSubtitleTracks(tabId, now = Date.now()) {
  const pending = pendingSubtitleTracksByTab.get(tabId) ?? [];
  const fresh = pending.filter((entry) => now - entry.capturedAt <= PENDING_NETWORK_BUFFER_MS).map((entry) => entry.track);
  pendingSubtitleTracksByTab.delete(tabId);
  return fresh;
}

function attachSubtitleTracksToCandidates(candidates, subtitleTracks) {
  const tracks = normalizeSubtitleTracks(subtitleTracks);
  if (tracks.length === 0) {
    return candidates;
  }
  return candidates.map((candidate) => ({
    ...candidate,
    subtitleTracks: mergeSubtitleTracks(candidate.subtitleTracks ?? [], tracks)
  }));
}

function mergeSubtitleTracks(existing, incoming) {
  const byUrl = new Map(normalizeSubtitleTracks(existing).map((track) => [track.url, track]));
  const normalizedIncoming = normalizeSubtitleTracks(incoming);
  for (const track of normalizedIncoming) {
    const current = byUrl.get(track.url);
    byUrl.set(track.url, current ? { ...current, ...track, headers: { ...(current.headers ?? {}), ...(track.headers ?? {}) } } : track);
  }
  return [...byUrl.values()];
}

function normalizeSubtitleTracks(tracks) {
  return (tracks ?? []).filter((track) => track?.url).map((track) => ({
    contentType: track.contentType ?? null,
    format: track.format ?? 'unknown',
    isDefault: track.isDefault ?? null,
    isSelected: track.isSelected ?? null,
    label: track.label ?? null,
    language: track.language ?? null,
    source: track.source ?? 'network',
    url: track.url,
    ...(track.headers ? { headers: track.headers } : {})
  }));
}

async function inspectHlsManifestCandidate(tabId, candidate) {
  if (candidate?.manifestType !== 'hls' || !candidate.url) {
    return;
  }
  const fetchKey = `${tabId}\n${normalizeUrlKey(candidate.url)}`;
  if (hlsManifestFetches.has(fetchKey)) {
    return;
  }
  hlsManifestFetches.add(fetchKey);

  try {
    const response = await fetch(candidate.url, {
      credentials: 'include',
      headers: manifestFetchHeaders(candidate.headers ?? {})
    });
    if (!response.ok) {
      await postHlsManifestDebugEvent(tabId, candidate, 'unavailable', `http-${response.status}`, {});
      return;
    }
    const manifest = await response.text();
    const metadata = parseHlsManifestMetadata(manifest, candidate.url);
    rememberHlsManifestMetadata(tabId, candidate.url, metadata);
    await applyKnownHlsMetadataToSession(tabId);
    const metadataAvailable = Boolean(metadata.resolution || metadata.subtitleTracks?.length);
    await postHlsManifestDebugEvent(tabId, candidate, metadataAvailable ? 'available' : 'unavailable', metadataAvailable ? null : 'no-variant-resolution', {
      resolution: metadata.resolution,
      subtitleTrackCount: metadata.subtitleTracks?.length ?? 0,
      variantCount: metadata.variants.length
    });
  } catch (error) {
    await postHlsManifestDebugEvent(tabId, candidate, 'unavailable', 'manifest-fetch-failed', {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function rememberHlsManifestMetadata(tabId, manifestUrl, metadata) {
  if (!metadata?.resolution && metadata?.variants?.length === 0 && metadata?.subtitleTracks?.length === 0) {
    return;
  }
  const byUrl = hlsMetadataByTab.get(tabId) ?? new Map();
  if (metadata.resolution || metadata.subtitleTracks?.length) {
    byUrl.set(normalizeUrlKey(manifestUrl), {
      resolution: metadata.resolution ?? null,
      subtitleTracks: metadata.subtitleTracks ?? []
    });
  }
  for (const variant of metadata.variants ?? []) {
    if (variant.resolution || metadata.subtitleTracks?.length) {
      byUrl.set(normalizeUrlKey(variant.url), {
        resolution: variant.resolution ?? null,
        subtitleTracks: metadata.subtitleTracks ?? []
      });
    }
  }
  hlsMetadataByTab.set(tabId, byUrl);
}

async function applyKnownHlsMetadataToSession(tabId) {
  let session = null;
  let changed = false;
  await upsertState((state) => {
    session = state.sessions[String(tabId)];
    if (!session) {
      return;
    }
    const enriched = session.candidates.map((candidate) => enrichCandidateWithKnownHlsMetadata(tabId, candidate));
    changed = enriched.some((candidate, index) => candidate !== session.candidates[index]);
    if (!changed) {
      return;
    }
    session.candidates = enriched;
    session.subtitleTracks = mergeSubtitleTracks(
      session.subtitleTracks ?? [],
      enriched.flatMap((candidate) => candidate.subtitleTracks ?? [])
    );
    session.updatedAt = new Date().toISOString();
  });

  if (session && changed) {
    await postCandidates(session.jobId, session.candidates);
    notifyPanel(tabId);
  }
}

function enrichCandidateWithKnownHlsMetadata(tabId, candidate) {
  if (candidate?.manifestType !== 'hls') {
    return candidate;
  }
  const metadata = hlsMetadataByTab.get(tabId)?.get(normalizeUrlKey(candidate.url));
  if (!metadata?.resolution && !metadata?.subtitleTracks?.length) {
    return candidate;
  }
  const subtitleTracks = mergeSubtitleTracks(candidate.subtitleTracks ?? [], metadata.subtitleTracks ?? []);
  const resolution = candidate.resolution ?? metadata.resolution ?? null;
  if (resolution === candidate.resolution && subtitleTracks.length === (candidate.subtitleTracks ?? []).length) {
    return candidate;
  }
  return { ...candidate, resolution, subtitleTracks };
}

function normalizeUrlKey(url) {
  try {
    return new URL(url).href;
  } catch {
    return String(url ?? '');
  }
}

function manifestFetchHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HLS_MANIFEST_FETCH_HEADER_NAMES.has(name.toLowerCase()) && value) {
      result[name] = value;
    }
  }
  if (!Object.keys(result).some((name) => name.toLowerCase() === 'accept')) {
    result.Accept = 'application/vnd.apple.mpegurl, application/x-mpegURL, */*';
  }
  return result;
}

async function postHlsManifestDebugEvent(tabId, candidate, status, reason, details) {
  await postExtensionDebugEvent({
    candidateUrl: candidate.url,
    details: {
      contentType: candidate.contentType,
      ...details
    },
    eventType: 'hls-manifest',
    reason,
    status,
    tabId
  }).catch(() => undefined);
}

function isSessionCaptureActive(session) {
  return typeof session.activeCaptureUntil === 'number' && session.activeCaptureUntil >= Date.now();
}

function enrichCandidatesWithPlaybackMetadata(candidates, playbackMetadata) {
  const metadata = normalizePlaybackMetadata(playbackMetadata);
  if (!metadata?.resolution) {
    return candidates;
  }
  return candidates.map((candidate) => {
    if (!shouldApplyPlaybackMetadata(candidate, metadata)) {
      return candidate;
    }
    return {
      ...candidate,
      durationSeconds: candidate.durationSeconds ?? metadata.durationSeconds ?? null,
      resolution: candidate.resolution ?? metadata.resolution
    };
  });
}

function shouldApplyPlaybackMetadata(candidate, metadata) {
  if (candidate.resolution || candidate.manifestType) {
    return false;
  }
  const contentType = normalizedContentType(candidate.contentType);
  if (contentType?.startsWith('audio/')) {
    return false;
  }
  if (metadata.currentSrc) {
    return sameUrl(candidate.url, metadata.currentSrc);
  }
  return Boolean(contentType?.startsWith('video/'));
}

function normalizePlaybackMetadata(value, currentSrc = null) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    currentSrc: normalizedHttpUrl(currentSrc ?? value.currentSrc ?? null),
    durationSeconds: Number.isFinite(value.durationSeconds) ? value.durationSeconds : null,
    resolution: typeof value.resolution === 'string' && /^\d+x\d+$/.test(value.resolution) ? value.resolution : null
  };
}

function normalizedHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function sameUrl(left, right) {
  if (!left || !right) {
    return false;
  }
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function normalizedContentType(value) {
  return value?.split(';')[0].trim().toLowerCase() ?? null;
}

async function selectSource(tabId, url) {
  const state = await getState();
  const sourceTabId = tabId ?? state.activeTabId ?? null;
  const session = state.sessions[String(sourceTabId ?? '')];
  if (!session) {
    throw new Error('No active source session');
  }
  const blockedReason = sourceSelectionBlockedReason(session);
  if (blockedReason) {
    throw new Error(blockedReason);
  }
  const cookieSnapshot = await cookieSnapshotForSession(session, url);
  if (cookieSnapshot.cookies.length > 0) {
    await postCookies(session.jobId, cookieSnapshot.cookies);
  }
  const sessionCandidates = withCookieHeaders(session.candidates, cookieSnapshot.cookiesByUrl);
  const candidates = await postCandidates(session.jobId, sessionCandidates);
  const selected = candidates.find((candidate) => candidate.url === url);
  if (!selected) {
    throw new Error('Selected source was not accepted by the app');
  }
  await fetch(`${APP_ORIGIN}/api/jobs/${session.jobId}/select-candidate`, {
    body: JSON.stringify({ candidateId: selected.id }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  }).then(ensureOk);
  await upsertState((nextState) => {
    const nextSession = nextState.sessions[String(sourceTabId ?? nextState.activeTabId ?? '')];
    if (nextSession) {
      nextSession.selectedUrl = url;
      nextSession.status = 'selected';
      nextSession.updatedAt = new Date().toISOString();
    }
  });
  notifyPanel(sourceTabId);
  await notifyAppSelection(session.appTabId, session.jobId);
  await focusAppTab(session.appTabId);
  return { ok: true };
}

function sourceSelectionBlockedReason(session) {
  if (session.playbackState === 'inactive') {
    return 'Resume playback before using this source';
  }
  if (typeof session.activePlaybackUntil === 'number' && session.activePlaybackUntil <= Date.now()) {
    return 'Resume playback before using this source';
  }
  return null;
}

async function cookieSnapshotForSession(session, selectedUrl) {
  const urls = uniqueHttpUrls([
    session.sourceUrl,
    session.currentUrl,
    selectedUrl,
    ...(session.candidates ?? []).map((candidate) => candidate.url)
  ]);
  const cookiesByUrl = {};
  const allCookies = [];
  for (const url of urls) {
    const cookies = await cookiesForUrl(url);
    cookiesByUrl[url] = cookies;
    allCookies.push(...cookies);
  }
  return { cookies: dedupeCookies(allCookies), cookiesByUrl };
}

async function cookiesForUrl(url) {
  if (!chrome.cookies?.getAll) {
    return [];
  }
  try {
    return (await chrome.cookies.getAll({ url })).map(normalizeCookie).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeCookie(cookie) {
  if (!cookie?.name || !cookie.domain || !cookie.path) {
    return null;
  }
  return {
    domain: cookie.domain,
    expirationDate: Number.isFinite(cookie.expirationDate) ? Math.floor(cookie.expirationDate) : null,
    httpOnly: Boolean(cookie.httpOnly),
    name: cookie.name,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    value: cookie.value ?? ''
  };
}

function uniqueHttpUrls(urls) {
  const result = [];
  const seen = new Set();
  for (const url of urls) {
    if (!url || seen.has(url)) {
      continue;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        continue;
      }
      result.push(parsed.href);
      seen.add(parsed.href);
    } catch {
      // Ignore invalid candidate URLs; schema validation already handles posted candidates.
    }
  }
  return result;
}

function withCookieHeaders(candidates, cookiesByUrl) {
  return candidates.map((candidate) => {
    const cookieHeader = cookieHeaderFor(cookiesByUrl[candidate.url] ?? []);
    if (!cookieHeader) {
      return candidate;
    }
    return { ...candidate, headers: { ...candidate.headers, Cookie: cookieHeader } };
  });
}

function cookieHeaderFor(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function dedupeCookies(cookies) {
  const byKey = new Map();
  for (const cookie of cookies) {
    byKey.set(`${cookie.domain}\t${cookie.path}\t${cookie.name}`, cookie);
  }
  return [...byKey.values()];
}

async function notifyAppSelection(appTabId, jobId) {
  if (appTabId == null) {
    return;
  }
  await sendTabMessage(appTabId, { jobId, type: 'SHV_SOURCE_SELECTED' }).catch(() => undefined);
}

async function focusAppTab(appTabId) {
  if (appTabId == null) {
    return;
  }
  try {
    const tab = await chrome.tabs.update(appTabId, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // The app tab may have been closed; selection has already succeeded.
  }
}

async function postCandidates(jobId, candidates) {
  return fetch(`${APP_ORIGIN}/api/jobs/${jobId}/extension-candidates`, {
    body: JSON.stringify({ candidates }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  }).then(ensureOk);
}

async function postCookies(jobId, cookies) {
  return fetch(`${APP_ORIGIN}/api/jobs/${jobId}/cookies`, {
    body: JSON.stringify({ cookies }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  }).then(ensureOk);
}

async function postExtensionDebugEvent(event) {
  return fetch(`${APP_ORIGIN}/api/debug/extension/events`, {
    body: JSON.stringify(event),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  }).then((response) => {
    if (!response.ok && response.status !== 404) {
      throw new Error('Could not record extension debug event');
    }
  });
}

async function ensureOk(response) {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.status === 204 ? null : response.json();
}

async function panelState() {
  const state = await getState();
  return { ok: true, state };
}

async function removeTabSession(tabId) {
  pendingNetworkCandidatesByTab.delete(tabId);
  hlsMetadataByTab.delete(tabId);
  for (const key of [...hlsManifestFetches]) {
    if (key.startsWith(`${tabId}\n`)) {
      hlsManifestFetches.delete(key);
    }
  }
  await upsertState((state) => {
    delete state.sessions[String(tabId)];
    if (state.activeTabId === tabId) {
      state.activeTabId = null;
    }
  });
}

async function getState() {
  const result = await chrome.storage.local.get('sourceState');
  return result.sourceState ?? { activeTabId: null, sessions: {} };
}

async function upsertState(mutator) {
  const update = stateWriteChain
    .catch(() => undefined)
    .then(async () => {
      const state = await getState();
      state.sessions ??= {};
      mutator(state);
      await chrome.storage.local.set({ sourceState: state });
    });
  stateWriteChain = update.catch(() => undefined);
  return update;
}

function notifyPanel(tabId = null) {
  chrome.runtime.sendMessage({ type: 'SHV_SOURCE_STATE_CHANGED' }).catch(() => undefined);
  if (tabId != null) {
    sendTabMessage(tabId, { tabId, type: 'SHV_SOURCE_STATE_CHANGED' }).catch(() => undefined);
  }
}

function headerValue(headers, name) {
  const match = headers.find((header) => header.name.toLowerCase() === name);
  return match?.value ?? null;
}

function downloadableRequestHeaders(headers) {
  const result = {};
  for (const header of headers) {
    const name = header.name.toLowerCase();
    if (DOWNLOAD_HEADER_NAMES.has(name) && header.value) {
      result[header.name] = header.value;
    }
  }
  return result;
}

function assertOpenSourceMessage(message) {
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Unsupported protocol version');
  }
  if (!message.jobId || !message.sourceUrl) {
    throw new Error('Missing jobId or sourceUrl');
  }
}

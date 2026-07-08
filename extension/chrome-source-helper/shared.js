export const PROTOCOL_VERSION = 1;
export const EXTENSION_VERSION = '1.0.28';
export const APP_ORIGIN = 'http://127.0.0.1:8080';

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'];

export function candidateFromUrl(url, contentType = null, kindOverride = null, baseUrl = undefined) {
  let parsed;
  try {
    parsed = new URL(url, baseUrl);
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

export function candidateRejectionReason(url, contentType = null) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `non-http protocol ${parsed.protocol}`;
  }
  if (parsed.searchParams.has('bytes')) {
    return 'explicit bytes query param';
  }
  if (parsed.searchParams.has('range')) {
    return 'explicit range query param';
  }
  if (isYoutubeSabrTransport(parsed, contentType)) {
    return 'YouTube SABR/UMP transport request';
  }
  const pathname = parsed.pathname.toLowerCase();
  const normalizedContentType = normalizedContentTypeFor(parsed, contentType);
  if (normalizedContentType?.includes('mpegurl') || pathname.endsWith('.m3u8')) {
    return 'accepted as HLS';
  }
  if (normalizedContentType === 'application/dash+xml' || pathname.endsWith('.mpd')) {
    return 'accepted as DASH';
  }
  if (normalizedContentType?.startsWith('video/') || VIDEO_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
    return 'accepted as direct video';
  }
  if (isGoogleVideoPlaybackUrl(parsed)) {
    return 'accepted as googlevideo videoplayback';
  }
  return 'no video content-type, extension, or mime query hint';
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

export function isServerDownloadableUrl(parsed) {
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

export function mergeCandidates(existing, incoming) {
  const byUrl = new Map(existing.map((candidate) => [candidate.url, candidate]));
  for (const candidate of incoming) {
    const current = byUrl.get(candidate.url);
    if (!current || candidate.confidence > current.confidence) {
      byUrl.set(candidate.url, { ...current, ...candidate, confidence: Math.max(current?.confidence ?? 0, candidate.confidence) });
    }
  }
  return [...byUrl.values()].sort((left, right) => right.confidence - left.confidence);
}

export function sessionTabIdsForRequest(details, state) {
  if (Number.isInteger(details?.tabId) && details.tabId >= 0) {
    return [details.tabId];
  }

  const requestOrigin = originOf(details?.initiator) ?? originOf(details?.documentUrl);
  if (!requestOrigin) {
    return [];
  }

  return Object.entries(state?.sessions ?? {})
    .filter(([, session]) => [session?.currentUrl, session?.sourceUrl].some((url) => originOf(url) === requestOrigin))
    .map(([tabId]) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
}

function originOf(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function candidate(kind, url, contentType, manifestType, confidence) {
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

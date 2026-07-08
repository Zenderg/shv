export const PROTOCOL_VERSION = 1;
export const EXTENSION_VERSION = '1.0.39';
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

export function candidateFromVerifiedVideoUrl(url, kindOverride = 'html-video', baseUrl = undefined) {
  const classified = candidateFromUrl(url, null, kindOverride, baseUrl);
  if (classified) {
    return classified;
  }
  let parsed;
  try {
    parsed = new URL(url, baseUrl);
  } catch {
    return null;
  }
  if (!isServerDownloadableUrl(parsed) || isYoutubeSabrTransport(parsed, null)) {
    return null;
  }
  return candidate(kindOverride, parsed.href, normalizedContentTypeFor(parsed, null), null, 0.91);
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

export function parseHlsManifestMetadata(manifest, baseUrl) {
  const variants = parseHlsVariants(manifest, baseUrl);
  return {
    resolution: variants[0]?.resolution ?? null,
    variants
  };
}

function parseHlsVariants(manifest, baseUrl) {
  if (typeof manifest !== 'string' || typeof baseUrl !== 'string') {
    return [];
  }
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }
    const attributes = parseHlsAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
    const nextUri = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith('#'));
    const resolution = normalizeResolution(attributes.RESOLUTION);
    if (!nextUri || !resolution) {
      continue;
    }
    try {
      variants.push({
        bandwidth: Number(attributes.BANDWIDTH ?? 0) || 0,
        resolution,
        url: new URL(nextUri, baseUrl).href
      });
    } catch {
      // Ignore malformed variant URLs; a bad line should not discard the rest of the manifest.
    }
  }

  return variants.sort(compareHlsVariants);
}

function parseHlsAttributes(input) {
  const attributes = {};
  let key = '';
  let value = '';
  let readingValue = false;
  let quoted = false;

  const commit = () => {
    const normalizedKey = key.trim().toUpperCase();
    if (normalizedKey) {
      attributes[normalizedKey] = value.trim().replace(/^"|"$/g, '');
    }
    key = '';
    value = '';
    readingValue = false;
    quoted = false;
  };

  for (const character of `${input},`) {
    if (!readingValue) {
      if (character === '=') {
        readingValue = true;
      } else if (character !== ',') {
        key += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      value += character;
      continue;
    }
    if (character === ',' && !quoted) {
      commit();
      continue;
    }
    value += character;
  }

  return attributes;
}

function compareHlsVariants(left, right) {
  const bandwidthDelta = right.bandwidth - left.bandwidth;
  if (bandwidthDelta !== 0) {
    return bandwidthDelta;
  }
  return resolutionArea(right.resolution) - resolutionArea(left.resolution);
}

function resolutionArea(resolution) {
  const match = /^(\d+)x(\d+)$/.exec(resolution ?? '');
  if (!match) {
    return 0;
  }
  return Number(match[1]) * Number(match[2]);
}

function normalizeResolution(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  return `${Number(match[1])}x${Number(match[2])}`;
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
    if (!current) {
      byUrl.set(candidate.url, candidate);
    } else {
      byUrl.set(candidate.url, mergeCandidate(current, candidate));
    }
  }
  return [...byUrl.values()].sort((left, right) => right.confidence - left.confidence);
}

function mergeCandidate(current, incoming) {
  const preferIncoming = incoming.confidence > current.confidence;
  const primary = preferIncoming ? incoming : current;
  const secondary = preferIncoming ? current : incoming;
  return {
    ...secondary,
    ...primary,
    bitrate: primary.bitrate ?? secondary.bitrate ?? null,
    confidence: Math.max(current.confidence ?? 0, incoming.confidence ?? 0),
    contentType: primary.contentType ?? secondary.contentType ?? null,
    durationSeconds: primary.durationSeconds ?? secondary.durationSeconds ?? null,
    headers: { ...(current.headers ?? {}), ...(incoming.headers ?? {}) },
    manifestType: primary.manifestType ?? secondary.manifestType ?? null,
    resolution: primary.resolution ?? secondary.resolution ?? null,
    sizeBytes: primary.sizeBytes ?? secondary.sizeBytes ?? null,
    url: current.url
  };
}

export function sessionTabIdsForRequest(details, state) {
  if (Number.isInteger(details?.tabId) && details.tabId >= 0) {
    return [details.tabId];
  }

  const exactDocumentUrl = details?.documentUrl ?? null;
  if (exactDocumentUrl) {
    const exactMatches = matchingSessionTabIds(state, (session) =>
      [session?.currentUrl, session?.sourceUrl].some((url) => url === exactDocumentUrl)
    );
    if (exactMatches.length === 1) {
      return exactMatches;
    }
  }

  const requestOrigin = originOf(details?.initiator) ?? originOf(details?.documentUrl);
  if (!requestOrigin) {
    return [];
  }

  const originMatches = matchingSessionTabIds(state, (session) =>
    [session?.currentUrl, session?.sourceUrl].some((url) => originOf(url) === requestOrigin)
  );
  return originMatches.length === 1 ? originMatches : [];
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

function matchingSessionTabIds(state, predicate) {
  return Object.entries(state?.sessions ?? {})
    .filter(([, session]) => predicate(session))
    .map(([tabId]) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
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

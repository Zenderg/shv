import type { MediaCandidate, SubtitleTrack } from '../../shared/types.js';

export interface CandidateDraft {
  kind: MediaCandidate['kind'];
  url: string;
  contentType: string | null;
  manifestType: MediaCandidate['manifestType'];
  resolution: string | null;
  bitrate: number | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  confidence: number;
  headers: Record<string, string>;
  subtitleTracks?: SubtitleTrack[];
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.ts']);
const VIDEO_CONTENT_TYPES = ['video/'];

export function isHlsUrl(url: string): boolean {
  return pathname(url).toLowerCase().endsWith('.m3u8');
}

export function isDashUrl(url: string): boolean {
  return pathname(url).toLowerCase().endsWith('.mpd');
}

export function isLikelyDirectVideo(url: string, contentType?: string | null): boolean {
  if (!isServerDownloadableUrl(url)) {
    return false;
  }
  const lowerPath = pathname(url).toLowerCase();
  const hasVideoExtension = [...VIDEO_EXTENSIONS].some((extension) => lowerPath.endsWith(extension));
  const hasVideoType = contentType ? VIDEO_CONTENT_TYPES.some((type) => contentType.toLowerCase().startsWith(type)) : false;
  return hasVideoExtension || hasVideoType;
}

export function classifyMediaUrl(url: string, contentType?: string | null): CandidateDraft | null {
  if (!isServerDownloadableUrl(url)) {
    return null;
  }
  if (isHlsUrl(url)) {
    return candidate('hls', url, contentType ?? 'application/vnd.apple.mpegurl', 'hls', 0.92);
  }
  if (isDashUrl(url)) {
    return candidate('dash', url, contentType ?? 'application/dash+xml', 'dash', 0.9);
  }
  if (isLikelyDirectVideo(url, contentType)) {
    return candidate('direct', url, contentType ?? null, null, contentType ? 0.86 : 0.7);
  }
  return null;
}

export function extractHtmlMediaCandidates(html: string, baseUrl: string): CandidateDraft[] {
  const candidates = new Map<string, CandidateDraft>();
  const sourceRegex = /<(?:video|source|a)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = sourceRegex.exec(html)) !== null) {
    const raw = match[1];
    try {
      const absoluteUrl = new URL(raw, baseUrl).toString();
      const detected = classifyMediaUrl(absoluteUrl);
      if (detected) {
        candidates.set(absoluteUrl, { ...detected, kind: detected.kind === 'direct' ? 'html-video' : detected.kind });
      }
    } catch {
      continue;
    }
  }

  return [...candidates.values()];
}

export function candidate(
  kind: CandidateDraft['kind'],
  url: string,
  contentType: string | null,
  manifestType: CandidateDraft['manifestType'],
  confidence: number
): CandidateDraft {
  return {
    kind,
    url,
    contentType,
    manifestType,
    resolution: null,
    bitrate: null,
    durationSeconds: null,
    sizeBytes: null,
    confidence,
    headers: {},
    subtitleTracks: []
  };
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isServerDownloadableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return !parsed.searchParams.has('bytes');
  } catch {
    return false;
  }
}

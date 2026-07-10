import { normalizeHttpUrl } from '../utils/networkSafety.js';

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
}

export interface HlsSegment {
  uri: string;
  durationSeconds: number | null;
}

export function parseHlsVariants(manifest: string, baseUrl: string): HlsVariant[] {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }
    const attributes = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
    const nextUri = lines.slice(index + 1).find((candidate) => candidate && !candidate.startsWith('#'));
    if (!nextUri) {
      continue;
    }
    variants.push({
      uri: normalizeHttpUrl(new URL(nextUri, baseUrl).toString()),
      bandwidth: Number(attributes.BANDWIDTH ?? 0),
      resolution: attributes.RESOLUTION ?? null
    });
  }

  return variants.sort((left, right) => right.bandwidth - left.bandwidth);
}

export function selectBestHlsVariant(manifest: string, baseUrl: string): string {
  const variants = parseHlsVariants(manifest, baseUrl);
  return variants[0]?.uri ?? baseUrl;
}

export function parseHlsDurationSeconds(manifest: string): number | null {
  let total = 0;
  let foundDuration = false;

  for (const match of manifest.matchAll(/^#EXTINF:([0-9.]+)/gm)) {
    const duration = Number(match[1]);
    if (!Number.isFinite(duration)) {
      continue;
    }
    total += duration;
    foundDuration = true;
  }

  return foundDuration ? total : null;
}

export function parseHlsSegments(manifest: string, baseUrl: string): HlsSegment[] {
  const lines = manifest.split(/\r?\n/).map((line) => line.trim());
  const segments: HlsSegment[] = [];
  let pendingDuration: number | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const duration = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      pendingDuration = Number.isFinite(duration) ? duration : null;
      continue;
    }
    if (!line || line.startsWith('#')) {
      continue;
    }
    segments.push({
      durationSeconds: pendingDuration,
      uri: normalizeHttpUrl(new URL(line, baseUrl).toString())
    });
    pendingDuration = null;
  }

  return segments;
}

export function parseHlsResourceUrls(manifest: string, baseUrl: string): string[] {
  const urls = new Set(parseHlsSegments(manifest, baseUrl).map((segment) => segment.uri));
  for (const line of manifest.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('#')) {
      continue;
    }
    for (const match of line.matchAll(/\bURI=(?:"([^"]+)"|([^,\s]+))/g)) {
      const value = match[1] ?? match[2];
      if (value) {
        urls.add(new URL(value, baseUrl).toString());
      }
    }
  }
  return [...urls];
}

export function canDownloadPlainHlsSegments(manifest: string, segments: HlsSegment[]): boolean {
  if (segments.length === 0) {
    return false;
  }
  if (/#EXT-X-(KEY|MAP|BYTERANGE):/.test(manifest)) {
    return false;
  }
  return segments.every((segment) => {
    try {
      return new URL(segment.uri).pathname.toLowerCase().endsWith('.ts');
    } catch {
      return false;
    }
  });
}

function parseAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  let key = '';
  let value = '';
  let readingValue = false;
  let quoted = false;

  const commit = () => {
    const normalizedKey = key.trim();
    if (normalizedKey) {
      result[normalizedKey] = value.trim().replace(/^"|"$/g, '');
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

  return result;
}

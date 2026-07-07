export interface HlsVariant {
  uri: string;
  bandwidth: number;
  resolution: string | null;
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
      uri: new URL(nextUri, baseUrl).toString(),
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

function parseAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of input.split(',')) {
    const [key, value] = part.split('=');
    if (key && value) {
      result[key.trim()] = value.trim().replace(/^"|"$/g, '');
    }
  }
  return result;
}

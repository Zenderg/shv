export interface DashRepresentation {
  id: string | null;
  bandwidth: number;
  width: number | null;
  height: number | null;
  baseUrl: string;
}

export interface DashRenditions {
  video: DashRepresentation | null;
  audio: DashRepresentation | null;
}

export function parseDashRepresentations(manifest: string, manifestUrl: string): DashRepresentation[] {
  return parseDashRepresentationsByType(manifest, manifestUrl, 'video');
}

export function parseDashAudioRepresentations(manifest: string, manifestUrl: string): DashRepresentation[] {
  return parseDashRepresentationsByType(manifest, manifestUrl, 'audio');
}

export function selectBestDashRenditions(manifest: string, manifestUrl: string): DashRenditions {
  return {
    video: parseDashRepresentations(manifest, manifestUrl)[0] ?? null,
    audio: parseDashAudioRepresentations(manifest, manifestUrl)[0] ?? null
  };
}

function parseDashRepresentationsByType(manifest: string, manifestUrl: string, type: 'video' | 'audio'): DashRepresentation[] {
  const adaptationBlocks = [...manifest.matchAll(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/gi)].map((match) => match[0]);
  const typedBlocks = adaptationBlocks.filter(
    (block) => new RegExp(`mimeType=["']${type}/`, 'i').test(block) || new RegExp(`contentType=["']${type}["']`, 'i').test(block)
  );
  const sourceBlocks = typedBlocks.length > 0 ? typedBlocks : type === 'video' ? adaptationBlocks : [];
  const results: DashRepresentation[] = [];

  for (const block of sourceBlocks) {
    for (const match of block.matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi)) {
      const attrs = parseXmlAttributes(match[1]);
      const nested = match[2];
      const nestedBase = xmlText(nested.match(/<BaseURL>([\s\S]*?)<\/BaseURL>/i)?.[1]);
      const blockBase = xmlText(block.match(/<BaseURL>([\s\S]*?)<\/BaseURL>/i)?.[1]);
      const base = nestedBase ?? blockBase ?? manifestUrl;
      results.push({
        id: attrs.id ?? null,
        bandwidth: Number(attrs.bandwidth ?? 0),
        width: attrs.width ? Number(attrs.width) : null,
        height: attrs.height ? Number(attrs.height) : null,
        baseUrl: new URL(base, manifestUrl).toString()
      });
    }
  }

  return results.sort((left, right) => right.bandwidth - left.bandwidth);
}

export function selectBestDashRepresentation(manifest: string, manifestUrl: string): DashRepresentation | null {
  return selectBestDashRenditions(manifest, manifestUrl).video;
}

function parseXmlAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of input.matchAll(/([\w:-]+)=["']([^"']+)["']/g)) {
    result[match[1]] = match[2];
  }
  return result;
}

function xmlText(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value
    .trim()
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

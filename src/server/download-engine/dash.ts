import { XMLParser } from 'fast-xml-parser';

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

type XmlNode = Record<string, unknown>;

const dashXmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true
});

export function parseDashRepresentations(manifest: string, manifestUrl: string): DashRepresentation[] {
  return parseDashRepresentationsByType(parseDashManifest(manifest), manifestUrl, 'video');
}

export function parseDashAudioRepresentations(manifest: string, manifestUrl: string): DashRepresentation[] {
  return parseDashRepresentationsByType(parseDashManifest(manifest), manifestUrl, 'audio');
}

export function selectBestDashRenditions(manifest: string, manifestUrl: string): DashRenditions {
  const document = parseDashManifest(manifest);
  return {
    video: parseDashRepresentationsByType(document, manifestUrl, 'video')[0] ?? null,
    audio: parseDashRepresentationsByType(document, manifestUrl, 'audio')[0] ?? null
  };
}

function parseDashManifest(manifest: string): XmlNode {
  const document = dashXmlParser.parse(manifest, true) as unknown;
  if (!isXmlNode(document)) {
    throw new Error('DASH manifest did not contain an XML document');
  }
  return document;
}

function parseDashRepresentationsByType(
  document: XmlNode,
  manifestUrl: string,
  type: 'video' | 'audio'
): DashRepresentation[] {
  const mpd = xmlChildNodes(document, 'MPD')[0];
  const periods = mpd ? xmlChildNodes(mpd, 'Period') : [];
  const adaptationSets = periods.flatMap((period) => xmlChildNodes(period, 'AdaptationSet'));
  const typedSets = adaptationSets.filter((adaptationSet) => isAdaptationType(adaptationSet, type));
  const sourceSets = typedSets.length > 0 ? typedSets : type === 'video' ? adaptationSets : [];
  const results: DashRepresentation[] = [];

  for (const adaptationSet of sourceSets) {
    const adaptationBaseUrl = xmlText(adaptationSet.BaseURL);
    for (const representation of xmlChildNodes(adaptationSet, 'Representation')) {
      const baseUrl = xmlText(representation.BaseURL) ?? adaptationBaseUrl;
      if (baseUrl == null) {
        continue;
      }

      results.push({
        id: xmlAttribute(representation, 'id'),
        bandwidth: Number(xmlAttribute(representation, 'bandwidth') ?? 0),
        width: xmlNumberAttribute(representation, 'width'),
        height: xmlNumberAttribute(representation, 'height'),
        baseUrl: new URL(baseUrl, manifestUrl).toString()
      });
    }
  }

  return results.sort((left, right) => right.bandwidth - left.bandwidth);
}

function isAdaptationType(adaptationSet: XmlNode, type: 'video' | 'audio'): boolean {
  return xmlAttribute(adaptationSet, 'mimeType')?.toLowerCase().startsWith(`${type}/`) === true
    || xmlAttribute(adaptationSet, 'contentType')?.toLowerCase() === type;
}

function xmlChildNodes(node: XmlNode, key: string): XmlNode[] {
  const value = node[key];
  const values = Array.isArray(value) ? value : [value];
  return values.filter(isXmlNode);
}

function isXmlNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function xmlAttribute(node: XmlNode, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' ? value : null;
}

function xmlNumberAttribute(node: XmlNode, key: string): number | null {
  const value = xmlAttribute(node, key);
  return value == null ? null : Number(value);
}

function xmlText(value: unknown): string | null {
  const firstValue = Array.isArray(value) ? value[0] : value;
  const text = typeof firstValue === 'string'
    ? firstValue
    : isXmlNode(firstValue) && typeof firstValue['#text'] === 'string'
      ? firstValue['#text']
      : null;

  if (text == null) {
    return null;
  }

  return text
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function selectBestDashRepresentation(manifest: string, manifestUrl: string): DashRepresentation | null {
  return selectBestDashRenditions(manifest, manifestUrl).video;
}

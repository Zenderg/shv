import { XMLParser } from 'fast-xml-parser';
import { normalizeHttpUrl } from '../utils/networkSafety.js';

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

export function parseDashDurationSeconds(manifest: string): number | null {
  const document = parseDashManifest(manifest);
  const mpd = xmlChildNodes(document, 'MPD')[0];
  if (!mpd || xmlAttribute(mpd, 'type')?.toLowerCase() === 'dynamic') {
    return null;
  }

  const presentationDuration = parseXmlDurationSeconds(xmlAttribute(mpd, 'mediaPresentationDuration'));
  if (presentationDuration !== null) {
    return presentationDuration;
  }

  const periods = xmlChildNodes(mpd, 'Period');
  return periods.length === 1 ? parseXmlDurationSeconds(xmlAttribute(periods[0], 'duration')) : null;
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
        baseUrl: normalizeHttpUrl(new URL(baseUrl, manifestUrl).toString())
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

  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function parseXmlDurationSeconds(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match || match.slice(1).every((part) => part === undefined)) return null;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  const total = Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function selectBestDashRepresentation(manifest: string, manifestUrl: string): DashRepresentation | null {
  return selectBestDashRenditions(manifest, manifestUrl).video;
}

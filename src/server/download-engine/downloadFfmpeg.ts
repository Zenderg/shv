import type { DashRepresentation } from './dash.js';
import { requestHeadersForUrl } from '../utils/downloadRequestHeaders.js';
import { normalizeHttpUrl } from '../utils/mediaUrl.js';

export function buildHlsFfmpegArgs(variantUrl: string, outputPath: string, proxyUrl: string): string[] {
  normalizeHttpUrl(variantUrl);
  return [
    '-y',
    ...ffmpegNetworkInputArgs(proxyUrl, { reconnectAtEof: false }),
    '-http_persistent',
    '0',
    '-headers',
    '',
    '-i',
    variantUrl,
    '-c',
    'copy',
    '-f',
    'matroska',
    outputPath
  ];
}

export function buildDashFfmpegArgs(
  video: DashRepresentation | null,
  audio: DashRepresentation | null,
  headers: Record<string, string>,
  outputPath: string,
  capturedManifestUrl: string,
  proxyUrls: { audio: string | null; video: string }
): string[] {
  const args = ['-y'];
  const primaryInput = video?.baseUrl;
  if (!primaryInput) {
    throw new Error('DASH manifest did not include a playable media representation');
  }

  normalizeHttpUrl(primaryInput);
  if (audio) {
    normalizeHttpUrl(audio.baseUrl);
  }

  args.push(
    ...ffmpegNetworkInputArgs(proxyUrls.video),
    '-headers',
    headersToFfmpeg(requestHeadersForUrl(headers, capturedManifestUrl, primaryInput)),
    '-i',
    primaryInput
  );
  if (audio) {
    if (!proxyUrls.audio) {
      throw new Error('DASH audio input requires an origin-locked proxy');
    }
    args.push(
      ...ffmpegNetworkInputArgs(proxyUrls.audio),
      '-headers',
      headersToFfmpeg(requestHeadersForUrl(headers, capturedManifestUrl, audio.baseUrl)),
      '-i',
      audio.baseUrl,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0'
    );
  }
  args.push('-c', 'copy', '-f', 'matroska', outputPath);
  return args;
}

export function formatFfmpegError(code: number | null, stderr: string): string {
  const detail = compactFfmpegLog(stderr);
  const prefix = isLikelyHlsSegmentFailure(stderr)
    ? `ffmpeg exited with code ${code}: HLS segment download failed after a network/TLS interruption or corrupt media segment.`
    : `ffmpeg exited with code ${code}`;
  return detail ? `${prefix}\nLast ffmpeg messages:\n${detail}` : prefix;
}

function ffmpegNetworkInputArgs(proxyUrl: string, options: { reconnectAtEof?: boolean } = {}): string[] {
  const args = [
    '-fflags',
    '+discardcorrupt',
    '-protocol_whitelist',
    'http,https,httpproxy,tcp,tls,crypto',
    '-http_proxy',
    proxyUrl,
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_on_network_error',
    '1',
    '-reconnect_on_http_error',
    '408,429,500,502,503,504',
    '-reconnect_delay_max',
    '10'
  ];
  if (options.reconnectAtEof ?? true) {
    args.splice(4, 0, '-reconnect_at_eof', '1');
  }
  return args;
}

function headersToFfmpeg(headers: Record<string, string>): string {
  const value = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  return value ? `${value}\r\n` : '';
}

function compactFfmpegLog(stderr: string): string {
  return stderr
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => redactSignedUrls(line.trim()))
    .filter((line) => line && !line.startsWith('frame=') && !line.startsWith('video:') && !line.startsWith('audio:'))
    .slice(-10)
    .join('\n');
}

function redactSignedUrls(line: string): string {
  return line.replace(/https?:\/\/[^\s'"]+/g, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      return parsed.search ? `${parsed.origin}${parsed.pathname}?<redacted>` : rawUrl;
    } catch {
      return rawUrl;
    }
  });
}

function isLikelyHlsSegmentFailure(stderr: string): boolean {
  return /hls|segment|Stream ends prematurely|Packet corrupt|ADTS|End of file|session has been invalidated|keepalive request failed/i.test(stderr);
}

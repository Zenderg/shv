import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { MediaCandidate } from '../../shared/types.js';
import { latestFfmpegTime } from '../media-processing/mediaProcessor.js';
import { canDownloadPlainHlsSegments, parseHlsDurationSeconds, parseHlsResourceUrls, parseHlsSegments, selectBestHlsVariant, type HlsSegment } from './hls.js';
import { selectBestDashRenditions, type DashRepresentation } from './dash.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { requestHeadersForUrl } from '../utils/downloadRequestHeaders.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';
import { assertPublicHttpUrlSyntax } from '../utils/networkSafety.js';
import { PublicMediaSession, type PublicHttpProxyOptions, type PublicMediaSessionLike } from '../utils/publicHttpProxy.js';
import type { Response as UndiciResponse } from 'undici';
import { downloadBrowserRequestMedia } from './browserRequestDownloader.js';

export interface DownloadResult {
  filePath: string;
  bytesWritten: number;
}

export interface BrowserRequestDownloadInput {
  url: string;
  headers: Record<string, string>;
  outputPath: string;
  onProgress: (progress: number) => void;
  proxyUrl: string;
  signal?: AbortSignal;
}

export type BrowserRequestDownloadRunner = (input: BrowserRequestDownloadInput) => Promise<DownloadResult>;
export type PublicUrlValidator = (url: string) => Promise<string>;
export type PublicMediaSessionFactory = (options?: PublicHttpProxyOptions) => Promise<PublicMediaSessionLike>;

const MAX_SAFE_REDIRECTS = 5;

export class DownloadEngine {
  constructor(
    private readonly browserRequestDownloader: BrowserRequestDownloadRunner = downloadBrowserRequestMedia,
    private readonly validatePublicUrl: PublicUrlValidator = async (url) => assertPublicHttpUrlSyntax(url),
    private readonly createMediaSession: PublicMediaSessionFactory = (options) => PublicMediaSession.start(options)
  ) {}

  async download(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    throwIfAborted(signal);
    const session = await this.createMediaSession();
    try {
      await this.validatePublicUrl(candidate.url);
      if (candidate.manifestType === 'hls') {
        return await this.downloadHls(candidate, outputPath, onProgress, session, signal);
      }
      if (candidate.manifestType === 'dash') {
        return await this.downloadDash(candidate, outputPath, onProgress, session, signal);
      }
      if (isDirectBrowserRequest(candidate)) {
        return await this.downloadBrowserRequestDirect(candidate, outputPath, onProgress, session, signal);
      }
      return await this.downloadDirect(candidate, outputPath, onProgress, session, signal);
    } finally {
      await session.close();
    }
  }

  private async downloadBrowserRequestDirect(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const existingBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    return this.browserRequestDownloader({
      headers: browserRequestHeaders(candidate.headers, existingBytes),
      onProgress,
      outputPath,
      proxyUrl: session.proxyUrl,
      signal,
      url: candidate.url
    });
  }

  private async downloadDirect(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const existingBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    const additionalHeaders: Record<string, string> = {};
    if (existingBytes > 0) {
      additionalHeaders.Range = `bytes=${existingBytes}-`;
    }

    let response = await this.fetchPublic(candidate.url, candidate.url, candidate.headers, session, { additionalHeaders, signal });
    let retriedWithoutRange = false;
    if (existingBytes > 0 && response.status === 206 && !hasRequestedContentRange(response, existingBytes)) {
      await response.body?.cancel();
      response = await this.fetchPublic(candidate.url, candidate.url, candidate.headers, session, { signal });
      retriedWithoutRange = true;
    }
    if (retriedWithoutRange && response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Download resume retry returned HTTP ${response.status}; expected a complete HTTP 200 response`);
    }
    if (!response.ok && response.status !== 206) {
      await response.body?.cancel();
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Download response did not include a body');
    }

    const append = response.status === 206 && existingBytes > 0;
    const total = Number(response.headers.get('content-length') ?? candidate.sizeBytes ?? 0) + (append ? existingBytes : 0);
    const stream = fs.createWriteStream(outputPath, { flags: append ? 'a' : 'w' });
    let written = append ? existingBytes : 0;

    const reader = response.body.getReader();
    const removeAbortListener = onAbort(signal, () => {
      void reader.cancel().catch(() => undefined);
      stream.destroy();
    });
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = value;
        written += chunk.byteLength;
        await writeChunk(stream, chunk);
        if (total > 0) {
          onProgress(Math.min(0.95, written / total));
        }
      }
    } finally {
      removeAbortListener();
    }
    throwIfAborted(signal);

    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async downloadHls(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const manifest = await this.fetchText(candidate.url, candidate.url, candidate.headers, session, signal);
    const variantUrl = selectBestHlsVariant(manifest, candidate.url);
    await this.validatePublicUrl(variantUrl);
    const mediaManifest = variantUrl === candidate.url
      ? manifest
      : await this.fetchText(variantUrl, candidate.url, candidate.headers, session, signal);
    const segments = parseHlsSegments(mediaManifest, variantUrl);
    const resourceUrls = parseHlsResourceUrls(mediaManifest, variantUrl);
    await Promise.all(resourceUrls.map((resourceUrl) => this.validatePublicUrl(resourceUrl)));
    const plainSegmentDownload = canDownloadPlainHlsSegments(mediaManifest, segments);
    const durationSeconds = parseHlsDurationSeconds(mediaManifest);
    logJobEvent('info', 'hls-manifest-selected', {
      durationSeconds,
      firstSegment: segments[0] ? safeUrlParts(segments[0].uri) : null,
      hasDiscontinuity: /#EXT-X-DISCONTINUITY\b/.test(mediaManifest),
      hasEndList: /#EXT-X-ENDLIST\b/.test(mediaManifest),
      input: safeUrlParts(candidate.url),
      jobId: jobIdFromOutputPath(outputPath),
      lastSegment: segments.at(-1) ? safeUrlParts(segments.at(-1)?.uri ?? '') : null,
      plainSegmentDownload,
      segmentCount: segments.length,
      targetDurationSeconds: hlsNumericTag(mediaManifest, 'EXT-X-TARGETDURATION'),
      variant: safeUrlParts(variantUrl)
    });
    if (plainSegmentDownload) {
      return this.downloadHlsSegments(segments, candidate.url, candidate.headers, outputPath, onProgress, session, signal);
    }
    await this.runFfmpeg(
      buildHlsFfmpegArgs(variantUrl, outputPath, session.proxyUrl),
      onProgress,
      signal,
      durationSeconds
    );
    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async downloadHlsSegments(
    segments: HlsSegment[],
    capturedUrl: string,
    headers: Record<string, string>,
    outputPath: string,
    onProgress: (progress: number) => void,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    fs.rmSync(outputPath, { force: true });
    const segmentDirectory = `${outputPath}.segments-${process.pid}-${Date.now()}`;
    fs.mkdirSync(segmentDirectory, { recursive: true });
    const totalDuration = segments.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0);
    const downloadedSegments: Array<{ durationSeconds: number | null; filePath: string }> = [];
    let completedDuration = 0;

    const progressForIndex = (index: number): number => {
      if (totalDuration > 0) {
        return completedDuration / totalDuration;
      }
      return (index + 1) / segments.length;
    };

    try {
      for (let index = 0; index < segments.length; index += 1) {
        throwIfAborted(signal);
        const segment = segments[index];
        const segmentPath = path.join(segmentDirectory, `segment-${String(index + 1).padStart(6, '0')}.ts`);
        const stream = fs.createWriteStream(segmentPath, { flags: 'w' });
        const response = await this.fetchPublic(segment.uri, capturedUrl, headers, session, { signal });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HLS segment ${index + 1} request failed with HTTP ${response.status}`);
        }
        if (!response.body) {
          throw new Error(`HLS segment ${index + 1} response did not include a body`);
        }

        const reader = response.body.getReader();
        const removeAbortListener = onAbort(signal, () => {
          void reader.cancel().catch(() => undefined);
          stream.destroy();
        });
        try {
          while (true) {
            throwIfAborted(signal);
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            await writeChunk(stream, value);
          }
        } finally {
          removeAbortListener();
        }
        await endStream(stream);
        downloadedSegments.push({ durationSeconds: segment.durationSeconds, filePath: segmentPath });

        completedDuration += segment.durationSeconds ?? 0;
        onProgress(Math.min(0.95, progressForIndex(index) * 0.95));
      }

      try {
        await stitchDownloadedHlsSegments(downloadedSegments, outputPath, signal);
        logJobEvent('info', 'hls-segments-stitched', {
          jobId: jobIdFromOutputPath(outputPath),
          method: 'ffmpeg-concat',
          segmentCount: downloadedSegments.length
        });
      } catch (error) {
        logJobEvent('warn', 'hls-segments-stitch-fallback', {
          error: shortMessage(error),
          jobId: jobIdFromOutputPath(outputPath),
          method: 'raw-concat',
          segmentCount: downloadedSegments.length
        });
        fs.rmSync(outputPath, { force: true });
        await concatenateDownloadedHlsSegments(downloadedSegments, outputPath, signal);
      }
    } catch (error) {
      throw error;
    } finally {
      fs.rmSync(segmentDirectory, { recursive: true, force: true });
    }

    onProgress(0.95);
    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async downloadDash(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const manifest = await this.fetchText(candidate.url, candidate.url, candidate.headers, session, signal);
    const selected = selectBestDashRenditions(manifest, candidate.url);
    if (selected.video) {
      await this.validatePublicUrl(selected.video.baseUrl);
    }
    if (selected.audio) {
      await this.validatePublicUrl(selected.audio.baseUrl);
    }
    if (!selected.video) {
      throw new Error('DASH manifest did not include a playable media representation');
    }

    const inputSessions: PublicMediaSessionLike[] = [];
    try {
      const videoSession = await this.createMediaSession(originLockedProxyOptions(selected.video.baseUrl));
      inputSessions.push(videoSession);
      const audioSession = selected.audio
        ? await this.createMediaSession(originLockedProxyOptions(selected.audio.baseUrl))
        : null;
      if (audioSession) {
        inputSessions.push(audioSession);
      }
      await this.runFfmpeg(
        buildDashFfmpegArgs(selected.video, selected.audio, candidate.headers, outputPath, candidate.url, {
          audio: audioSession?.proxyUrl ?? null,
          video: videoSession.proxyUrl
        }),
        onProgress,
        signal
      );
    } finally {
      await Promise.all(inputSessions.map((inputSession) => inputSession.close()));
    }
    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async runFfmpeg(
    args: string[],
    onProgress: (progress: number) => void,
    signal?: AbortSignal,
    durationSeconds?: number | null
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
      let stderr = '';
      let progressLog = '';
      child.stdout.on('data', (chunk: Buffer) => {
        progressLog = `${progressLog}${chunk.toString('utf8')}`.slice(-12000);
        const current = latestFfmpegTime(progressLog);
        if (durationSeconds && current != null) {
          onProgress(Math.min(0.95, current / durationSeconds));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      child.on('error', (error) => {
        removeAbortListener();
        reject(error);
      });
      child.on('close', (code) => {
        removeAbortListener();
        if (signal?.aborted) {
          reject(new JobCanceledError());
          return;
        }
        if (code === 0) {
          onProgress(0.95);
          resolve();
        } else {
          reject(new Error(formatFfmpegError(code, stderr)));
        }
      });
    });
  }

  private async fetchText(
    url: string,
    capturedUrl: string,
    capturedHeaders: Record<string, string>,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await this.fetchPublic(url, capturedUrl, capturedHeaders, session, { signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Manifest request failed with HTTP ${response.status}`);
    }
    return response.text();
  }

  private async fetchPublic(
    url: string,
    capturedUrl: string,
    capturedHeaders: Record<string, string>,
    session: PublicMediaSessionLike,
    options: { additionalHeaders?: Record<string, string>; signal?: AbortSignal }
  ): Promise<UndiciResponse> {
    let targetUrl = await this.validatePublicUrl(url);

    for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
      const response = await session.fetch(targetUrl, {
        headers: {
          ...requestHeadersForUrl(capturedHeaders, capturedUrl, targetUrl),
          ...options.additionalHeaders
        },
        redirect: 'manual',
        signal: options.signal
      });
      if (!isRedirect(response.status)) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      if (redirectCount === MAX_SAFE_REDIRECTS) {
        await response.body?.cancel();
        throw new Error(`Media request exceeded ${MAX_SAFE_REDIRECTS} redirects`);
      }

      await response.body?.cancel();
      targetUrl = await this.validatePublicUrl(new URL(location, targetUrl).toString());
    }

    throw new Error('Media request redirect handling failed unexpectedly');
  }
}

export function buildHlsFfmpegArgs(variantUrl: string, outputPath: string, proxyUrl: string): string[] {
  assertPublicHttpUrlSyntax(variantUrl);
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

function isDirectBrowserRequest(candidate: MediaCandidate): boolean {
  return candidate.kind === 'browser-request' && candidate.manifestType === null;
}

function browserRequestHeaders(headers: Record<string, string>, existingBytes: number): Record<string, string> {
  return {
    ...headers,
    Range: `bytes=${Math.max(0, existingBytes)}-`,
    'Sec-Fetch-Dest': headers['Sec-Fetch-Dest'] ?? headers['sec-fetch-dest'] ?? 'video',
    'Sec-Fetch-Mode': headers['Sec-Fetch-Mode'] ?? headers['sec-fetch-mode'] ?? 'no-cors',
    'Sec-Fetch-Site': headers['Sec-Fetch-Site'] ?? headers['sec-fetch-site'] ?? 'cross-site'
  };
}

function hasRequestedContentRange(response: UndiciResponse, existingBytes: number): boolean {
  const contentRange = response.headers.get('content-range');
  const match = contentRange?.match(/^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/i);
  return match?.[1] === String(existingBytes);
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

  assertPublicHttpUrlSyntax(primaryInput);
  if (audio) {
    assertPublicHttpUrlSyntax(audio.baseUrl);
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

function originLockedProxyOptions(url: string): PublicHttpProxyOptions {
  return { allowedOrigins: new Set([new URL(url).origin]) };
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

function hlsNumericTag(manifest: string, tag: string): number | null {
  const match = manifest.match(new RegExp(`^#${tag}:(\\d+(?:\\.\\d+)?)`, 'm'));
  const value = match ? Number(match[1]) : null;
  return Number.isFinite(value) ? value : null;
}

function jobIdFromOutputPath(outputPath: string): string | null {
  return path.basename(path.dirname(outputPath)) || null;
}

async function writeChunk(stream: fs.WriteStream, chunk: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

async function endStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

async function stitchDownloadedHlsSegments(
  segments: Array<{ durationSeconds: number | null; filePath: string }>,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  const listPath = `${outputPath}.ffconcat`;
  const lines = ['ffconcat version 1.0'];
  for (const segment of segments) {
    lines.push(`file '${escapeFfconcatPath(segment.filePath)}'`);
    if (segment.durationSeconds != null) {
      lines.push(`duration ${segment.durationSeconds}`);
    }
  }
  fs.writeFileSync(listPath, `${lines.join('\n')}\n`);
  try {
    await runFfmpegCommand([
      '-hide_banner',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      '-f',
      'mpegts',
      outputPath
    ], signal);
  } finally {
    fs.rmSync(listPath, { force: true });
  }
}

async function concatenateDownloadedHlsSegments(
  segments: Array<{ filePath: string }>,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  const output = fs.createWriteStream(outputPath, { flags: 'w' });
  try {
    for (const segment of segments) {
      throwIfAborted(signal);
      await new Promise<void>((resolve, reject) => {
        const input = fs.createReadStream(segment.filePath);
        input.on('error', reject);
        output.on('error', reject);
        input.on('end', resolve);
        input.on('data', (chunk) => {
          input.pause();
          output.write(chunk, (error) => {
            if (error) {
              reject(error);
              return;
            }
            input.resume();
          });
        });
      });
    }
  } catch (error) {
    output.destroy();
    throw error;
  }
  await endStream(output);
}

async function runFfmpegCommand(args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (error) => {
      removeAbortListener();
      reject(error);
    });
    child.on('close', (code) => {
      removeAbortListener();
      if (signal?.aborted) {
        reject(new JobCanceledError());
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

function escapeFfconcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
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

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { MediaCandidate } from '../../shared/types.js';
import { latestFfmpegTime } from '../media-processing/mediaProcessor.js';
import { canDownloadPlainHlsSegments, completeHlsSegmentDurationSeconds, parseHlsDurationSeconds, parseHlsResourceUrls, parseHlsSegments, selectBestHlsVariant, type HlsSegment } from './hls.js';
import { parseDashDurationSeconds, selectBestDashRenditions } from './dash.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { requestHeadersForUrl } from '../utils/downloadRequestHeaders.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';
import { assertPublicHttpUrlSyntax } from '../utils/networkSafety.js';
import { PublicMediaSession, type PublicHttpProxyOptions, type PublicMediaSessionLike } from '../utils/publicHttpProxy.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';
import type { Response as UndiciResponse } from 'undici';
import { downloadBrowserRequestMedia } from './browserRequestDownloader.js';
import { buildDashFfmpegArgs, buildHlsFfmpegArgs, formatFfmpegError } from './downloadFfmpeg.js';
import { concatenateDownloadedHlsSegments, endWriteStream, stitchDownloadedHlsSegments } from './hlsFileAssembler.js';

export { buildDashFfmpegArgs, buildHlsFfmpegArgs, formatFfmpegError } from './downloadFfmpeg.js';

export interface DownloadResult {
  filePath: string;
  bytesWritten: number;
}

export interface BrowserRequestDownloadInput {
  url: string;
  headers: Record<string, string>;
  outputPath: string;
  onProgress: TaskProgressCallback;
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
    onProgress: TaskProgressCallback,
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
    onProgress: TaskProgressCallback,
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
    onProgress: TaskProgressCallback,
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
    const total = responseTotalBytes(response, append ? existingBytes : 0, candidate.sizeBytes);
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
          onProgress(progressUpdate(Math.min(0.99, written / total)));
        } else {
          onProgress(activityUpdate());
        }
      }
    } finally {
      removeAbortListener();
    }
    throwIfAborted(signal);

    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

    onProgress(progressUpdate(1));

    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async downloadHls(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: TaskProgressCallback,
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
    onProgress: TaskProgressCallback,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    fs.rmSync(outputPath, { force: true });
    const segmentDirectory = `${outputPath}.segments-${process.pid}-${Date.now()}`;
    fs.mkdirSync(segmentDirectory, { recursive: true });
    const totalDuration = completeHlsSegmentDurationSeconds(segments);
    const downloadedSegments: Array<{ durationSeconds: number | null; filePath: string }> = [];
    let completedDuration = 0;

    const progressForIndex = (index: number): number => {
      if (totalDuration !== null) {
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
            onProgress(activityUpdate());
          }
        } finally {
          removeAbortListener();
        }
        await endWriteStream(stream);
        downloadedSegments.push({ durationSeconds: segment.durationSeconds, filePath: segmentPath });

        completedDuration += segment.durationSeconds ?? 0;
        onProgress(progressUpdate(Math.min(0.99, progressForIndex(index))));
      }

      try {
        await stitchDownloadedHlsSegments(downloadedSegments, outputPath, () => onProgress(activityUpdate()), signal);
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
        await concatenateDownloadedHlsSegments(downloadedSegments, outputPath, () => onProgress(activityUpdate()), signal);
      }
    } catch (error) {
      throw error;
    } finally {
      fs.rmSync(segmentDirectory, { recursive: true, force: true });
    }

    onProgress(progressUpdate(1));
    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async downloadDash(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: TaskProgressCallback,
    session: PublicMediaSessionLike,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const manifest = await this.fetchText(candidate.url, candidate.url, candidate.headers, session, signal);
    const selected = selectBestDashRenditions(manifest, candidate.url);
    const durationSeconds = parseDashDurationSeconds(manifest) ?? positiveDuration(candidate.durationSeconds);
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
        signal,
        durationSeconds
      );
    } finally {
      await Promise.all(inputSessions.map((inputSession) => inputSession.close()));
    }
    return { filePath: outputPath, bytesWritten: fs.statSync(outputPath).size };
  }

  private async runFfmpeg(
    args: string[],
    onProgress: TaskProgressCallback,
    signal?: AbortSignal,
    durationSeconds?: number | null
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
      let stderr = '';
      let progressLog = '';
      let lastReportedTime = -1;
      child.stdout.on('data', (chunk: Buffer) => {
        progressLog = `${progressLog}${chunk.toString('utf8')}`.slice(-12000);
        const current = latestFfmpegTime(progressLog);
        if (current != null && current > lastReportedTime) {
          lastReportedTime = current;
          onProgress(durationSeconds ? progressUpdate(Math.min(0.99, current / durationSeconds)) : activityUpdate());
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
          onProgress(progressUpdate(1));
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

function responseTotalBytes(response: UndiciResponse, resumedBytes: number, candidateSizeBytes: number | null): number {
  const contentRange = response.headers.get('content-range');
  const rangeTotalMatch = contentRange?.match(/\/([0-9]+)$/);
  const rangeTotal = rangeTotalMatch ? Number(rangeTotalMatch[1]) : 0;
  if (Number.isFinite(rangeTotal) && rangeTotal > 0) return rangeTotal;

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return response.status === 206 ? resumedBytes + contentLength : contentLength;
  }

  return Number.isFinite(candidateSizeBytes) && (candidateSizeBytes ?? 0) > 0 ? candidateSizeBytes ?? 0 : 0;
}

function positiveDuration(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function originLockedProxyOptions(url: string): PublicHttpProxyOptions {
  return { allowedOrigins: new Set([new URL(url).origin]) };
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

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

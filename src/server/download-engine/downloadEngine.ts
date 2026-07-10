import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { MediaCandidate } from '../../shared/types.js';
import { latestFfmpegTime } from '../media-processing/mediaProcessor.js';
import { canDownloadPlainHlsSegments, parseHlsDurationSeconds, parseHlsResourceUrls, parseHlsSegments, selectBestHlsVariant, type HlsSegment } from './hls.js';
import { selectBestDashRenditions, type DashRepresentation } from './dash.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { requestHeadersForUrl, requestHeadersForUrls } from '../utils/downloadRequestHeaders.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';

export interface DownloadResult {
  filePath: string;
  bytesWritten: number;
}

export interface BrowserRequestDownloadInput {
  url: string;
  headers: Record<string, string>;
  outputPath: string;
  onProgress: (progress: number) => void;
  signal?: AbortSignal;
}

export type BrowserRequestDownloadRunner = (input: BrowserRequestDownloadInput) => Promise<DownloadResult>;

export class DownloadEngine {
  constructor(private readonly browserRequestDownloader: BrowserRequestDownloadRunner = downloadBrowserRequestMedia) {}

  async download(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    throwIfAborted(signal);
    if (candidate.manifestType === 'hls') {
      return this.downloadHls(candidate, outputPath, onProgress, signal);
    }
    if (candidate.manifestType === 'dash') {
      return this.downloadDash(candidate, outputPath, onProgress, signal);
    }
    if (isDirectBrowserRequest(candidate)) {
      return this.downloadBrowserRequestDirect(candidate, outputPath, onProgress, signal);
    }
    return this.downloadDirect(candidate, outputPath, onProgress, signal);
  }

  private async downloadBrowserRequestDirect(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const existingBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    return this.browserRequestDownloader({
      headers: browserRequestHeaders(candidate.headers, existingBytes),
      onProgress,
      outputPath,
      signal,
      url: candidate.url
    });
  }

  private async downloadDirect(
    candidate: MediaCandidate,
    outputPath: string,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const existingBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    const headers: Record<string, string> = { ...candidate.headers };
    if (existingBytes > 0) {
      headers.Range = `bytes=${existingBytes}-`;
    }

    const response = await fetch(candidate.url, { headers, signal });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Download response did not include a body');
    }

    const total = Number(response.headers.get('content-length') ?? candidate.sizeBytes ?? 0) + (response.status === 206 ? existingBytes : 0);
    const stream = fs.createWriteStream(outputPath, { flags: response.status === 206 ? 'a' : 'w' });
    let written = response.status === 206 ? existingBytes : 0;

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
        stream.write(chunk);
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
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const manifest = await fetchText(candidate.url, candidate.headers, signal);
    const variantUrl = selectBestHlsVariant(manifest, candidate.url);
    const mediaManifest = variantUrl === candidate.url
      ? manifest
      : await fetchText(variantUrl, requestHeadersForUrl(candidate.headers, candidate.url, variantUrl), signal);
    const segments = parseHlsSegments(mediaManifest, variantUrl);
    const resourceUrls = parseHlsResourceUrls(mediaManifest, variantUrl);
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
      return this.downloadHlsSegments(segments, candidate.url, candidate.headers, outputPath, onProgress, signal);
    }
    const ffmpegHeaders = requestHeadersForUrls(candidate.headers, candidate.url, [variantUrl, ...resourceUrls]);
    await this.runFfmpeg(
      buildHlsFfmpegArgs(variantUrl, ffmpegHeaders, outputPath),
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
        const response = await fetch(segment.uri, {
          headers: requestHeadersForUrl(headers, capturedUrl, segment.uri),
          signal
        });
        if (!response.ok) {
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
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    const manifest = await fetchText(candidate.url, candidate.headers, signal);
    const selected = selectBestDashRenditions(manifest, candidate.url);
    await this.runFfmpeg(buildDashFfmpegArgs(selected.video, selected.audio, candidate.headers, outputPath, candidate.url), onProgress, signal);
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
}

async function downloadBrowserRequestMedia(input: BrowserRequestDownloadInput): Promise<DownloadResult> {
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  throwIfAborted(input.signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', browserRequestDownloadScript], { stdio: ['pipe', 'pipe', 'pipe'] });
    const removeAbortListener = onAbort(input.signal, () => child.kill('SIGTERM'));
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    const settle = (callback: () => void) => {
      removeAbortListener();
      callback();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout = `${stdout}${text}`.slice(-4000);
      lineBuffer += text;
      let newlineIndex = lineBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (line) {
          const progress = progressFromBrowserRequestLine(line);
          if (progress != null) {
            input.onProgress(progress);
          }
        }
        newlineIndex = lineBuffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    child.on('error', (error) => {
      settle(() => reject(error));
    });
    child.on('close', (code) => {
      if (input.signal?.aborted) {
        settle(() => reject(new JobCanceledError()));
        return;
      }
      if (code === 0) {
        input.onProgress(0.95);
        settle(() => resolve());
        return;
      }
      settle(() => reject(new Error(formatBrowserRequestDownloadError(code, `${stdout}\n${stderr}`))));
    });
    child.stdin.end(JSON.stringify({ headers: input.headers, outputPath: input.outputPath, url: input.url }));
  });
  throwIfAborted(input.signal);
  return { filePath: input.outputPath, bytesWritten: fs.statSync(input.outputPath).size };
}

export function buildHlsFfmpegArgs(variantUrl: string, headers: Record<string, string>, outputPath: string): string[] {
  return [
    '-y',
    ...ffmpegNetworkInputArgs({ reconnectAtEof: false }),
    '-http_persistent',
    '0',
    '-headers',
    headersToFfmpeg(headers),
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

function progressFromBrowserRequestLine(line: string): number | null {
  try {
    const message = JSON.parse(line) as { progress?: unknown };
    const progress = typeof message.progress === 'number' ? message.progress : null;
    return progress == null || !Number.isFinite(progress) ? null : Math.min(0.95, Math.max(0, progress));
  } catch {
    return null;
  }
}

function formatBrowserRequestDownloadError(code: number | null, log: string): string {
  const detail = redactSignedUrls(log.trim());
  return detail
    ? `Browser-impersonated media download exited with code ${code}: ${detail}`
    : `Browser-impersonated media download exited with code ${code}`;
}

const browserRequestDownloadScript = String.raw`
import json
import os
import sys

from curl_cffi import requests


def report(progress):
    print(json.dumps({"progress": progress}), flush=True)


payload = json.loads(sys.stdin.read())
url = payload["url"]
headers = payload["headers"]
output_path = payload["outputPath"]
existing_bytes = 0
range_header = headers.get("Range") or headers.get("range") or ""
if range_header.startswith("bytes=") and range_header.endswith("-"):
    try:
        existing_bytes = max(0, int(range_header.removeprefix("bytes=").removesuffix("-")))
    except ValueError:
        existing_bytes = 0

os.makedirs(os.path.dirname(output_path), exist_ok=True)
response = requests.get(url, headers=headers, impersonate="chrome", stream=True, timeout=30)
if response.status_code < 200 or response.status_code >= 300:
    raise RuntimeError(f"HTTP {response.status_code}")

content_range = response.headers.get("content-range") or response.headers.get("Content-Range")
content_length = int(response.headers.get("content-length") or response.headers.get("Content-Length") or 0)
total = content_length
if content_range and "/" in content_range:
    try:
        total = int(content_range.rsplit("/", 1)[1])
    except ValueError:
        total = content_length

append = response.status_code == 206 and existing_bytes > 0
written = existing_bytes if append else 0
mode = "ab" if append else "wb"
last_report = written
reported_cap = False
with open(output_path, mode + "") as output:
    for chunk in response.iter_content(chunk_size=262144):
        if not chunk:
            continue
        output.write(chunk)
        written += len(chunk)
        if total > 0 and not reported_cap and (written - last_report >= 1048576 or written >= total):
            progress = min(0.95, written / total)
            report(progress)
            reported_cap = progress >= 0.95
            last_report = written

if total > 0 and not reported_cap:
    report(min(0.95, written / total))
`;

export function buildDashFfmpegArgs(
  video: DashRepresentation | null,
  audio: DashRepresentation | null,
  headers: Record<string, string>,
  outputPath: string,
  fallbackInput?: string
): string[] {
  const args = ['-y'];
  const primaryInput = video?.baseUrl ?? fallbackInput;
  if (!primaryInput) {
    throw new Error('DASH manifest did not include a playable media representation');
  }

  const capturedUrl = fallbackInput ?? primaryInput;
  args.push(
    ...ffmpegNetworkInputArgs(),
    '-headers',
    headersToFfmpeg(requestHeadersForUrl(headers, capturedUrl, primaryInput)),
    '-i',
    primaryInput
  );
  if (audio) {
    args.push(
      ...ffmpegNetworkInputArgs(),
      '-headers',
      headersToFfmpeg(requestHeadersForUrl(headers, capturedUrl, audio.baseUrl)),
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

function ffmpegNetworkInputArgs(options: { reconnectAtEof?: boolean } = {}): string[] {
  const args = [
    '-fflags',
    '+discardcorrupt',
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

async function fetchText(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    throw new Error(`Manifest request failed with HTTP ${response.status}`);
  }
  return response.text();
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

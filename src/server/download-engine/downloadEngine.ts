import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { MediaCandidate } from '../../shared/types.js';
import { latestFfmpegTime } from '../media-processing/mediaProcessor.js';
import { parseHlsDurationSeconds, selectBestHlsVariant } from './hls.js';
import { selectBestDashRenditions, type DashRepresentation } from './dash.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';

export interface DownloadResult {
  filePath: string;
  bytesWritten: number;
}

export class DownloadEngine {
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
    return this.downloadDirect(candidate, outputPath, onProgress, signal);
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
    const mediaManifest = variantUrl === candidate.url ? manifest : await fetchText(variantUrl, candidate.headers, signal);
    const durationSeconds = parseHlsDurationSeconds(mediaManifest);
    await this.runFfmpeg(
      buildHlsFfmpegArgs(variantUrl, candidate.headers, outputPath),
      onProgress,
      signal,
      durationSeconds
    );
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

export function buildHlsFfmpegArgs(variantUrl: string, headers: Record<string, string>, outputPath: string): string[] {
  return [
    '-y',
    ...ffmpegNetworkInputArgs(),
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

export function buildDashFfmpegArgs(
  video: DashRepresentation | null,
  audio: DashRepresentation | null,
  headers: Record<string, string>,
  outputPath: string,
  fallbackInput?: string
): string[] {
  const headerArgs = headersToFfmpeg(headers);
  const args = ['-y'];
  const primaryInput = video?.baseUrl ?? fallbackInput;
  if (!primaryInput) {
    throw new Error('DASH manifest did not include a playable media representation');
  }

  args.push(...ffmpegNetworkInputArgs(), '-headers', headerArgs, '-i', primaryInput);
  if (audio) {
    args.push(...ffmpegNetworkInputArgs(), '-headers', headerArgs, '-i', audio.baseUrl, '-map', '0:v:0', '-map', '1:a:0');
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

function ffmpegNetworkInputArgs(): string[] {
  return [
    '-fflags',
    '+discardcorrupt',
    '-reconnect',
    '1',
    '-reconnect_at_eof',
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

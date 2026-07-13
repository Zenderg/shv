import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { SubtitleTrack } from '../../shared/types.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';

export interface ProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  browserFriendly: boolean;
}

export interface NormalizeResult extends ProbeResult {
  outputPath: string;
  thumbnailPath: string | null;
  processingStrategy: 'moved' | 'remuxed' | 'transcoded';
  remuxRejectionReason?: string;
}

type MoveFileSystem = Pick<typeof fs, 'copyFileSync' | 'renameSync' | 'rmSync'>;
interface TranscodeOptions {
  preserveInputTimestamps?: boolean;
}

export class MediaProcessor {
  async normalize(
    inputPath: string,
    outputPath: string,
    thumbnailPath: string,
    onProgress: TaskProgressCallback = () => undefined,
    signal?: AbortSignal
  ): Promise<NormalizeResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });

    throwIfAborted(signal);
    onProgress(activityUpdate('Inspecting video'));
    const probe = await this.probe(inputPath, signal);
    let processingStrategy: NormalizeResult['processingStrategy'] = 'transcoded';
    let remuxRejectionReason: string | undefined;
    if (probe.browserFriendly && path.resolve(inputPath) !== path.resolve(outputPath)) {
      throwIfAborted(signal);
      onProgress(activityUpdate('Moving video'));
      moveFile(inputPath, outputPath);
      processingStrategy = 'moved';
    } else if (shouldRemuxToBrowserFriendlyMp4(probe)) {
      try {
        onProgress(activityUpdate('Remuxing video'));
        await this.remuxToMp4(inputPath, outputPath, probe.durationSeconds, onProgress, signal);
        const remuxProbe = await this.probe(outputPath, signal);
        if (hasSuspiciousDurationInflation(probe.durationSeconds, remuxProbe.durationSeconds)) {
          throw new Error(`remux inflated duration from ${probe.durationSeconds}s to ${remuxProbe.durationSeconds}s`);
        }
        await assertPlayableTimestamps(outputPath, signal);
        processingStrategy = 'remuxed';
      } catch (error) {
        if (signal?.aborted || error instanceof JobCanceledError) {
          throw error;
        }
        remuxRejectionReason = shortProcessingMessage(error);
        fs.rmSync(outputPath, { force: true });
        onProgress(activityUpdate('Transcoding video'));
        await this.transcode(inputPath, outputPath, probe.durationSeconds, onProgress, signal, {
          preserveInputTimestamps: shouldPreserveInputTimestampsAfterRemuxRejection(remuxRejectionReason)
        });
        const transcodeProbe = await this.probe(outputPath, signal);
        assertNoSuspiciousDurationInflation('transcode', probe.durationSeconds, transcodeProbe.durationSeconds, outputPath);
        processingStrategy = 'transcoded';
      }
      if (path.resolve(inputPath) !== path.resolve(outputPath) && fs.existsSync(inputPath)) {
        fs.rmSync(inputPath, { force: true });
      }
    } else if (!probe.browserFriendly) {
      onProgress(activityUpdate('Transcoding video'));
      await this.transcode(inputPath, outputPath, probe.durationSeconds, onProgress, signal);
      const transcodeProbe = await this.probe(outputPath, signal);
      assertNoSuspiciousDurationInflation('transcode', probe.durationSeconds, transcodeProbe.durationSeconds, outputPath);
      processingStrategy = 'transcoded';
      if (path.resolve(inputPath) !== path.resolve(outputPath) && fs.existsSync(inputPath)) {
        fs.rmSync(inputPath, { force: true });
      }
    }

    throwIfAborted(signal);
    onProgress(activityUpdate('Creating thumbnail'));
    await this.thumbnail(outputPath, thumbnailPath, signal);
    onProgress(activityUpdate('Finalizing video'));
    const finalProbe = await this.probe(outputPath, signal);
    throwIfAborted(signal);
    onProgress(progressUpdate(1, 'Finalizing video'));
    return {
      ...finalProbe,
      outputPath,
      thumbnailPath: fs.existsSync(thumbnailPath) ? thumbnailPath : null,
      processingStrategy,
      ...(remuxRejectionReason ? { remuxRejectionReason } : {})
    };
  }

  async probe(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
    const raw = await run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ], signal);
    const parsed = JSON.parse(raw) as {
      format?: { duration?: string; format_name?: string; size?: string };
      streams?: FfprobeStream[];
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    const dimensions = video ? videoDisplayDimensions(video) : { width: null, height: null };
    const container = parsed.format?.format_name ?? null;
    const videoCodec = video?.codec_name ?? null;
    const audioCodec = audio?.codec_name ?? null;
    const sizeBytes = Number(parsed.format?.size ?? fs.statSync(filePath).size);
    const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;

    return {
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes,
      container,
      videoCodec,
      audioCodec,
      browserFriendly: isBrowserFriendly(container, videoCodec, audioCodec)
    };
  }

  async burnSubtitle(
    inputPath: string,
    subtitleTrack: SubtitleTrack & { localPath: string },
    onProgress: TaskProgressCallback = () => undefined,
    signal?: AbortSignal
  ): Promise<ProbeResult> {
    const temporaryPath = temporarySubtitledPath(inputPath);
    onProgress(activityUpdate('Adding subtitles'));
    const probe = await this.probe(inputPath, signal);
    await runProgressFfmpeg(buildBurnSubtitleArgs(inputPath, temporaryPath, subtitleTrack), probe.durationSeconds, onProgress, signal);
    moveFile(temporaryPath, inputPath);
    return this.probe(inputPath, signal);
  }

  private async transcode(
    inputPath: string,
    outputPath: string,
    durationSeconds: number | null,
    onProgress: TaskProgressCallback,
    signal?: AbortSignal,
    options: TranscodeOptions = {}
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', buildTranscodeArgs(inputPath, outputPath, options), { stdio: ['ignore', 'ignore', 'pipe'] });
      const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
      const stderr: Buffer[] = [];
      let progressLog = '';
      let lastReportedTime = -1;
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
        progressLog = `${progressLog}${chunk.toString('utf8')}`.slice(-12000);
        const current = latestFfmpegTime(progressLog);
        if (current != null && current > lastReportedTime) {
          lastReportedTime = current;
          onProgress(durationSeconds ? progressUpdate(Math.min(0.99, current / durationSeconds)) : activityUpdate());
        }
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
          reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
        }
      });
    });
  }

  private async remuxToMp4(
    inputPath: string,
    outputPath: string,
    durationSeconds: number | null,
    onProgress: TaskProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-hide_banner',
        '-y',
        '-i',
        inputPath,
        '-nostats',
        '-progress',
        'pipe:2',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        outputPath
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
      const stderr: Buffer[] = [];
      let progressLog = '';
      let lastReportedTime = -1;
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
        progressLog = `${progressLog}${chunk.toString('utf8')}`.slice(-12000);
        const current = latestFfmpegTime(progressLog);
        if (current != null && current > lastReportedTime) {
          lastReportedTime = current;
          onProgress(durationSeconds ? progressUpdate(Math.min(0.99, current / durationSeconds)) : activityUpdate());
        }
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
          reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
        }
      });
    });
  }

  private async thumbnail(inputPath: string, thumbnailPath: string, signal?: AbortSignal): Promise<void> {
    await run('ffmpeg', ['-hide_banner', '-y', '-ss', '00:00:01', '-i', inputPath, '-frames:v', '1', '-q:v', '3', thumbnailPath], signal);
  }
}

async function runProgressFfmpeg(
  args: string[],
  durationSeconds: number | null,
  onProgress: TaskProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const stderr: Buffer[] = [];
    let progressLog = '';
    let lastReportedTime = -1;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      progressLog = `${progressLog}${chunk.toString('utf8')}`.slice(-12000);
      const current = latestFfmpegTime(progressLog);
      if (current != null && current > lastReportedTime) {
        lastReportedTime = current;
        onProgress(durationSeconds ? progressUpdate(Math.min(0.99, current / durationSeconds)) : activityUpdate());
      }
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
        reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
      }
    });
  });
}

export function buildBurnSubtitleArgs(inputPath: string, outputPath: string, subtitleTrack: SubtitleTrack & { localPath: string }): string[] {
  return [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-nostats',
    '-progress',
    'pipe:2',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `subtitles=filename='${escapeSubtitleFilterPath(subtitleTrack.localPath)}'`,
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-preset',
    'veryfast',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath
  ];
}

function escapeSubtitleFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

export function buildTranscodeArgs(inputPath: string, outputPath: string, options: TranscodeOptions = {}): string[] {
  return [
    '-hide_banner',
    '-y',
    ...(options.preserveInputTimestamps ? ['-copyts', '-start_at_zero'] : []),
    '-i',
    inputPath,
    // Structured progress is more reliable than ffmpeg's human-readable stats,
    // which can be sparse or rewritten in-place for long transcodes.
    '-nostats',
    '-progress',
    'pipe:2',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    outputPath
  ];
}

export function latestFfmpegTime(input: string): number | null {
  const latestOutTime = [...input.matchAll(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
  if (latestOutTime) {
    return parseTimestamp(latestOutTime);
  }

  const latestOutTimeUs = [...input.matchAll(/out_time_us=(\d+)/g)].at(-1);
  if (latestOutTimeUs) {
    return Number(latestOutTimeUs[1]) / 1_000_000;
  }

  const latestOutTimeMs = [...input.matchAll(/out_time_ms=(\d+)/g)].at(-1);
  if (latestOutTimeMs) {
    return Number(latestOutTimeMs[1]) / 1_000_000;
  }

  const matches = [...input.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const latest = matches.at(-1);
  if (!latest) {
    return null;
  }
  return parseTimestamp(latest);
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export function videoDisplayDimensions(stream: Pick<FfprobeStream, 'height' | 'side_data_list' | 'tags' | 'width'>): {
  width: number | null;
  height: number | null;
} {
  const width = normalizedDimension(stream.width);
  const height = normalizedDimension(stream.height);
  if (width === null || height === null) {
    return { width: null, height: null };
  }

  const rotation = normalizedRotation(stream.side_data_list?.find((sideData) => typeof sideData.rotation === 'number')?.rotation ?? stream.tags?.rotate);
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function normalizedDimension(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizedRotation(value: number | string | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return ((Math.round(numeric) % 360) + 360) % 360;
}

function parseTimestamp(match: RegExpMatchArray): number {
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

function temporarySubtitledPath(inputPath: string): string {
  const extension = path.extname(inputPath) || '.mp4';
  return path.join(path.dirname(inputPath), `${path.basename(inputPath, extension)}.with-subtitles${extension}`);
}

export function moveFile(inputPath: string, outputPath: string, fileSystem: MoveFileSystem = fs): void {
  try {
    fileSystem.renameSync(inputPath, outputPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EXDEV') {
      throw error;
    }
    fileSystem.copyFileSync(inputPath, outputPath);
    fileSystem.rmSync(inputPath, { force: true });
  }
}

export function shouldRemuxToBrowserFriendlyMp4(probe: ProbeResult): boolean {
  return !probe.browserFriendly && !isMp4Container(probe.container) && hasBrowserCompatibleCodecs(probe.videoCodec, probe.audioCodec);
}

export function hasSuspiciousDurationInflation(inputDurationSeconds: number | null, outputDurationSeconds: number | null): boolean {
  if (!inputDurationSeconds || !outputDurationSeconds) {
    return false;
  }
  const toleranceSeconds = Math.max(2, inputDurationSeconds * 0.01);
  return outputDurationSeconds > inputDurationSeconds + toleranceSeconds;
}

export function hasTimestampWarnings(stderr: string): boolean {
  return /non monotonically increasing dts|invalid, non monotonically increasing|timestamp.*(invalid|discontinuity)/i.test(stderr);
}

function shouldPreserveInputTimestampsAfterRemuxRejection(reason: string): boolean {
  return /duration|timestamp|dts/i.test(reason);
}

function assertNoSuspiciousDurationInflation(
  operation: string,
  inputDurationSeconds: number | null,
  outputDurationSeconds: number | null,
  outputPath: string
): void {
  if (!hasSuspiciousDurationInflation(inputDurationSeconds, outputDurationSeconds)) {
    return;
  }
  fs.rmSync(outputPath, { force: true });
  throw new Error(`${operation} inflated duration from ${inputDurationSeconds}s to ${outputDurationSeconds}s`);
}

function isBrowserFriendly(container: string | null, videoCodec: string | null, audioCodec: string | null): boolean {
  return isMp4Container(container) && hasBrowserCompatibleCodecs(videoCodec, audioCodec);
}

function isMp4Container(container: string | null): boolean {
  return Boolean(container?.includes('mp4') || container?.includes('mov'));
}

function hasBrowserCompatibleCodecs(videoCodec: string | null, audioCodec: string | null): boolean {
  const videoOk = videoCodec === 'h264' || videoCodec === 'av1' || videoCodec === 'vp9';
  const audioOk = !audioCodec || audioCodec === 'aac' || audioCodec === 'mp3' || audioCodec === 'opus';
  return videoOk && audioOk;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function shortProcessingMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

async function assertPlayableTimestamps(filePath: string, signal?: AbortSignal): Promise<void> {
  const stderr = await runWithStderr('ffmpeg', ['-hide_banner', '-v', 'warning', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-'], signal);
  if (hasTimestampWarnings(stderr)) {
    throw new Error(`ffmpeg reported invalid timestamps while validating remuxed output: ${firstTimestampWarning(stderr)}`);
  }
}

function firstTimestampWarning(stderr: string): string {
  return shortProcessingMessage(stderr.split(/\r?\n/).find((line) => hasTimestampWarnings(line)) ?? stderr);
}

async function runWithStderr(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      removeAbortListener();
      reject(error);
    });
    child.on('close', (code) => {
      removeAbortListener();
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (signal?.aborted) {
        reject(new JobCanceledError());
        return;
      }
      if (code === 0) {
        resolve(stderrText);
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderrText}`));
      }
    });
  });
}

async function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
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
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
      }
    });
  });
}

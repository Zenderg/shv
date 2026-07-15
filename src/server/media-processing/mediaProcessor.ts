import fs from 'node:fs';
import path from 'node:path';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SubtitleTrack } from '../../shared/types.js';
import { JobCanceledError, throwIfAborted } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';
import { runMediaCommand, runProgressFfmpeg, runWithStderr } from './mediaProcessRunner.js';

export { latestFfmpegTime } from './mediaProcessRunner.js';

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

interface MoveFileSystem {
  createReadStream(filePath: string): Readable;
  createWriteStream(filePath: string): Writable;
  rename(inputPath: string, outputPath: string): Promise<void>;
  rm(filePath: string, options: { force: boolean }): Promise<void>;
  stat(filePath: string): Promise<{ size: number }>;
}

const nodeMoveFileSystem: MoveFileSystem = {
  createReadStream: (filePath) => fs.createReadStream(filePath),
  createWriteStream: (filePath) => fs.createWriteStream(filePath, { flags: 'w' }),
  rename: (inputPath, outputPath) => fs.promises.rename(inputPath, outputPath),
  rm: (filePath, options) => fs.promises.rm(filePath, options),
  stat: (filePath) => fs.promises.stat(filePath)
};

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
      await moveFile(inputPath, outputPath, onProgress, signal);
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
    const raw = await runMediaCommand('ffprobe', [
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
    await moveFile(temporaryPath, inputPath, onProgress, signal);
    onProgress(activityUpdate('Inspecting subtitled video'));
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
    await runProgressFfmpeg(buildTranscodeArgs(inputPath, outputPath, options), durationSeconds, onProgress, signal);
  }

  private async remuxToMp4(
    inputPath: string,
    outputPath: string,
    durationSeconds: number | null,
    onProgress: TaskProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    await runProgressFfmpeg([
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
    ], durationSeconds, onProgress, signal);
  }

  private async thumbnail(inputPath: string, thumbnailPath: string, signal?: AbortSignal): Promise<void> {
    await runMediaCommand('ffmpeg', ['-hide_banner', '-y', '-ss', '00:00:01', '-i', inputPath, '-frames:v', '1', '-q:v', '3', thumbnailPath], signal);
  }
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

function temporarySubtitledPath(inputPath: string): string {
  const extension = path.extname(inputPath) || '.mp4';
  return path.join(path.dirname(inputPath), `${path.basename(inputPath, extension)}.with-subtitles${extension}`);
}

export async function moveFile(
  inputPath: string,
  outputPath: string,
  onProgress: TaskProgressCallback = () => undefined,
  signal?: AbortSignal,
  fileSystem: MoveFileSystem = nodeMoveFileSystem
): Promise<void> {
  throwIfAborted(signal);
  onProgress(activityUpdate('Moving video'));
  try {
    await fileSystem.rename(inputPath, outputPath);
    throwIfAborted(signal);
    onProgress(progressUpdate(1, 'Moving video'));
    return;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EXDEV') {
      throw error;
    }
  }

  let inputStat: { size: number };
  try {
    inputStat = await fileSystem.stat(inputPath);
  } catch (error) {
    if (signal?.aborted) {
      throw new JobCanceledError();
    }
    throw error;
  }
  throwIfAborted(signal);
  const totalBytes = Number.isFinite(inputStat.size) && inputStat.size > 0 ? inputStat.size : null;

  let copiedBytes = 0;
  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        copiedBytes += chunk.byteLength;
        onProgress(totalBytes === null
          ? activityUpdate('Moving video')
          : progressUpdate(Math.min(0.99, copiedBytes / totalBytes), 'Moving video'));
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  try {
    await pipeline(
      fileSystem.createReadStream(inputPath),
      progressStream,
      fileSystem.createWriteStream(outputPath),
      { signal }
    );
    throwIfAborted(signal);
    await fileSystem.rm(inputPath, { force: true });
  } catch (error) {
    const copyError = signal?.aborted ? new JobCanceledError() : error;
    try {
      await fileSystem.rm(outputPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [copyError, cleanupError],
        `Moving video failed and the partial output could not be removed: ${outputPath}`
      );
    }
    throw copyError;
  }

  onProgress(progressUpdate(1, 'Moving video'));
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
  const stderr = await runWithStderr(
    'ffmpeg',
    ['-hide_banner', '-v', 'warning', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-'],
    signal,
    hasTimestampWarnings
  );
  if (hasTimestampWarnings(stderr)) {
    throw new Error(`ffmpeg reported invalid timestamps while validating remuxed output: ${firstTimestampWarning(stderr)}`);
  }
}

function firstTimestampWarning(stderr: string): string {
  return shortProcessingMessage(stderr.split(/\r?\n/).find((line) => hasTimestampWarnings(line)) ?? stderr);
}

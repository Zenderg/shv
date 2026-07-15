import { spawn } from 'node:child_process';
import { JobCanceledError, onAbort } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';

export async function runProgressFfmpeg(
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

export async function runWithStderr(command: string, args: string[], signal?: AbortSignal): Promise<string> {
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

export async function runMediaCommand(command: string, args: string[], signal?: AbortSignal): Promise<string> {
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

function parseTimestamp(match: RegExpMatchArray): number {
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

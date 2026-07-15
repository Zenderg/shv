import { spawn } from 'node:child_process';
import { JobCanceledError, onAbort } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';

export const PROCESS_STDERR_TAIL_BYTES = 16 * 1024;
export const PROCESS_STDOUT_MAX_BYTES = 4 * 1024 * 1024;

export class ProcessOutputTail {
  private value = Buffer.alloc(0);

  constructor(private readonly maxBytes = PROCESS_STDERR_TAIL_BYTES) {}

  append(chunk: Buffer): void {
    if (chunk.length >= this.maxBytes) {
      this.value = Buffer.from(chunk.subarray(chunk.length - this.maxBytes));
      return;
    }
    const combined = Buffer.concat([this.value, chunk]);
    this.value = combined.length > this.maxBytes
      ? Buffer.from(combined.subarray(combined.length - this.maxBytes))
      : combined;
  }

  toString(): string {
    return this.value.toString('utf8');
  }

  get byteLength(): number {
    return this.value.length;
  }
}

export async function runProgressFfmpeg(
  args: string[],
  durationSeconds: number | null,
  onProgress: TaskProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const stderr = new ProcessOutputTail();
    let progressLog = '';
    let lastReportedTime = -1;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.append(chunk);
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
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.toString()}`));
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

export async function runWithStderr(
  command: string,
  args: string[],
  signal?: AbortSignal,
  preserveLine?: (line: string) => boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const stderr = new ProcessOutputTail();
    let incompleteLine = '';
    let preservedLine: string | null = null;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.append(chunk);
      if (!preserveLine || preservedLine) {
        return;
      }
      const lines = `${incompleteLine}${chunk.toString('utf8')}`.split(/\r?\n/);
      incompleteLine = (lines.pop() ?? '').slice(-PROCESS_STDERR_TAIL_BYTES);
      preservedLine = lines.find(preserveLine) ?? null;
    });
    child.on('error', (error) => {
      removeAbortListener();
      reject(error);
    });
    child.on('close', (code) => {
      removeAbortListener();
      if (!preservedLine && preserveLine && preserveLine(incompleteLine)) {
        preservedLine = incompleteLine;
      }
      const stderrTail = stderr.toString();
      const stderrText = preservedLine && !stderrTail.includes(preservedLine)
        ? `${preservedLine}\n${stderrTail}`
        : stderrTail;
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
    const stderr = new ProcessOutputTail();
    let stdoutBytes = 0;
    let stdoutOverflow: Error | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutOverflow) {
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes > PROCESS_STDOUT_MAX_BYTES) {
        stdoutOverflow = new Error(`${command} output exceeded ${PROCESS_STDOUT_MAX_BYTES} bytes`);
        child.kill('SIGTERM');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
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
      if (stdoutOverflow) {
        reject(stdoutOverflow);
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr.toString()}`));
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

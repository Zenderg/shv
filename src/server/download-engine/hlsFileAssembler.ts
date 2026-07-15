import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';

export async function endWriteStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

export async function stitchDownloadedHlsSegments(
  segments: Array<{ durationSeconds: number | null; filePath: string }>,
  outputPath: string,
  onActivity: () => void,
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
      '-nostats',
      '-progress',
      'pipe:1',
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
    ], onActivity, signal);
  } finally {
    fs.rmSync(listPath, { force: true });
  }
}

export async function concatenateDownloadedHlsSegments(
  segments: Array<{ filePath: string }>,
  outputPath: string,
  onActivity: () => void,
  signal?: AbortSignal
): Promise<void> {
  const output = fs.createWriteStream(outputPath, { flags: 'w' });
  try {
    for (const segment of segments) {
      throwIfAborted(signal);
      const input = fs.createReadStream(segment.filePath);
      const removeAbortListener = onAbort(signal, () => {
        input.destroy();
        output.destroy();
      });
      try {
        for await (const chunk of input) {
          throwIfAborted(signal);
          onActivity();
          await writeChunk(output, chunk as Buffer);
        }
      } catch (error) {
        if (signal?.aborted) {
          throw new JobCanceledError();
        }
        throw error;
      } finally {
        removeAbortListener();
      }
    }
  } catch (error) {
    output.destroy();
    throw error;
  }
  await endWriteStream(output);
}

async function writeChunk(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

async function runFfmpegCommand(args: string[], onActivity: () => void, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    let stderr = '';
    child.stdout.on('data', () => {
      onActivity();
    });
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

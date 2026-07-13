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

export async function concatenateDownloadedHlsSegments(
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
  await endWriteStream(output);
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

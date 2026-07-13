import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DownloadResult } from '../download-engine/downloadEngine.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback, type TaskProgressUpdate } from '../utils/taskProgress.js';

export interface SourceExtractor {
  canHandle(sourceUrl: string): boolean;
  download(sourceUrl: string, outputPath: string, onProgress: TaskProgressCallback, signal?: AbortSignal): Promise<DownloadResult>;
}

export interface YtDlpSourceExtractorOptions {
  cookiesPath?: string | null;
}

export class NoopSourceExtractor implements SourceExtractor {
  canHandle(): boolean {
    return false;
  }

  async download(): Promise<DownloadResult> {
    throw new Error('No source extractor is available for this URL');
  }
}

export class YtDlpSourceExtractor implements SourceExtractor {
  constructor(private readonly options: YtDlpSourceExtractorOptions = {}) {}

  canHandle(sourceUrl: string): boolean {
    return isYouTubeUrl(sourceUrl);
  }

  async download(
    sourceUrl: string,
    outputPath: string,
    onProgress: TaskProgressCallback,
    signal?: AbortSignal
  ): Promise<DownloadResult> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    cleanOutputArtifacts(outputPath);
    throwIfAborted(signal);
    await runYtDlp(buildYtDlpArgs(sourceUrl, outputTemplateFor(outputPath), { cookiesPath: this.usableCookiesPath() }), onProgress, signal);
    throwIfAborted(signal);
    const downloadedPath = findDownloadedOutput(outputPath);
    if (!downloadedPath) {
      throw new Error('yt-dlp completed without writing the source file');
    }
    if (downloadedPath !== outputPath) {
      fs.renameSync(downloadedPath, outputPath);
    }
    return { bytesWritten: fs.statSync(outputPath).size, filePath: outputPath };
  }

  private usableCookiesPath(): string | undefined {
    const cookiesPath = this.options.cookiesPath?.trim();
    return cookiesPath && fs.existsSync(cookiesPath) ? cookiesPath : undefined;
  }
}

export function isYouTubeUrl(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(
      parsed.hostname
    );
  } catch {
    return false;
  }
}

export function buildYtDlpArgs(sourceUrl: string, outputTemplate: string, options: YtDlpSourceExtractorOptions = {}): string[] {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--force-overwrites',
    '--js-runtimes',
    'node',
    '-f',
    'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
    sourceUrl
  ];
  if (options.cookiesPath) {
    args.splice(0, 0, '--cookies', options.cookiesPath);
  }
  return args;
}

function outputTemplateFor(outputPath: string): string {
  return `${outputPath}.%(ext)s`;
}

function cleanOutputArtifacts(outputPath: string): void {
  fs.rmSync(outputPath, { force: true });
  for (const artifactPath of outputArtifactPaths(outputPath)) {
    fs.rmSync(artifactPath, { force: true });
  }
}

function findDownloadedOutput(outputPath: string): string | null {
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }
  const artifacts = outputArtifactPaths(outputPath).filter((artifactPath) => fs.existsSync(artifactPath));
  return artifacts.find((artifactPath) => artifactPath.endsWith('.mp4')) ?? artifacts[0] ?? null;
}

function outputArtifactPaths(outputPath: string): string[] {
  const directory = path.dirname(outputPath);
  const basename = path.basename(outputPath);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter((name) => name.startsWith(`${basename}.`)).map((name) => path.join(directory, name));
}

async function runYtDlp(args: string[], onProgress: TaskProgressCallback, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const removeAbortListener = onAbort(signal, () => child.kill('SIGTERM'));
    const progressTracker = createYtDlpProgressTracker();
    let log = '';
    const appendLog = (chunk: Buffer, channel: YtDlpOutputChannel) => {
      const text = chunk.toString('utf8');
      log = `${log}${text}`.slice(-8000);
      for (const update of progressTracker.push(text, channel)) {
        onProgress(update);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => appendLog(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => appendLog(chunk, 'stderr'));
    child.on('error', (error) => {
      removeAbortListener();
      reject(error);
    });
    child.on('close', (code) => {
      removeAbortListener();
      for (const update of progressTracker.flush()) {
        onProgress(update);
      }
      if (signal?.aborted) {
        reject(new JobCanceledError());
        return;
      }
      if (code === 0) {
        onProgress(progressUpdate(1));
        resolve();
        return;
      }
      reject(new Error(formatYtDlpError(code, log)));
    });
  });
}

type YtDlpOutputChannel = 'stdout' | 'stderr';

export interface YtDlpProgressTracker {
  push(text: string, channel?: YtDlpOutputChannel): TaskProgressUpdate[];
  flush(): TaskProgressUpdate[];
}

export function createYtDlpProgressTracker(): YtDlpProgressTracker {
  const buffers: Record<YtDlpOutputChannel, string> = { stderr: '', stdout: '' };
  let lastProgress: number | null = null;
  let indeterminateLabel: string | null = null;

  const updateForLine = (line: string): TaskProgressUpdate | null => {
    const progress = parseYtDlpProgress(line);
    if (progress != null) {
      if (indeterminateLabel) {
        return activityUpdate(indeterminateLabel);
      }
      if (lastProgress !== null && progress < lastProgress - 0.05) {
        indeterminateLabel = 'Downloading additional media stream';
        return activityUpdate(indeterminateLabel);
      }
      lastProgress = Math.max(lastProgress ?? 0, progress);
      return progressUpdate(Math.min(0.99, lastProgress), 'Downloading media');
    }

    if (/\[Merger\]/.test(line)) {
      indeterminateLabel = 'Merging media streams';
      return activityUpdate(indeterminateLabel);
    }
    if (/\[(?:ExtractAudio|Fixup)\]/.test(line)) {
      indeterminateLabel = 'Finalizing download';
      return activityUpdate(indeterminateLabel);
    }
    if (/\[download\]/.test(line)) {
      return activityUpdate(indeterminateLabel ?? 'Downloading media');
    }
    return null;
  };

  const drainCompleteLines = (channel: YtDlpOutputChannel): TaskProgressUpdate[] => {
    const updates: TaskProgressUpdate[] = [];
    let newlineIndex = buffers[channel].indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffers[channel].slice(0, newlineIndex).trim();
      buffers[channel] = buffers[channel].slice(newlineIndex + 1);
      const update = line ? updateForLine(line) : null;
      if (update) updates.push(update);
      newlineIndex = buffers[channel].indexOf('\n');
    }
    return updates;
  };

  return {
    push(text, channel = 'stdout') {
      buffers[channel] += text;
      return drainCompleteLines(channel);
    },
    flush() {
      const updates: TaskProgressUpdate[] = [];
      for (const channel of ['stdout', 'stderr'] as const) {
        const line = buffers[channel].trim();
        buffers[channel] = '';
        const update = line ? updateForLine(line) : null;
        if (update) updates.push(update);
      }
      return updates;
    }
  };
}

function formatYtDlpError(code: number | null, log: string): string {
  const detail = log.trim();
  if (/Sign in to confirm/i.test(detail) || /not a bot/i.test(detail)) {
    return [
      `yt-dlp exited with code ${code}: YouTube requires authenticated cookies for this video.`,
      'Open the page through the updated source helper extension and click Use source so the local app receives the relevant browser cookies.',
      'You can also provide a Netscape-format cookies file at /data/app/youtube-cookies.txt or set YTDLP_COOKIES_FILE.',
      detail
    ].join('\n');
  }
  return detail ? `yt-dlp exited with code ${code}: ${detail}` : `yt-dlp exited with code ${code}`;
}

function parseYtDlpProgress(text: string): number | null {
  const match = text.match(/\[download\]\s+([0-9.]+)%/);
  if (!match) {
    return null;
  }
  const percent = Number(match[1]);
  return Number.isFinite(percent) ? percent / 100 : null;
}

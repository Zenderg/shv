import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DownloadResult } from '../download-engine/downloadEngine.js';
import { JobCanceledError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';

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
    let log = '';
    const appendLog = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      log = `${log}${text}`.slice(-8000);
      const progress = parseYtDlpProgress(text);
      if (progress != null) {
        onProgress(progressUpdate(Math.min(0.99, progress)));
      } else if (/\[(?:download|Merger|ExtractAudio|Fixup)\]/.test(text)) {
        onProgress(activityUpdate());
      }
    };
    child.stdout.on('data', appendLog);
    child.stderr.on('data', appendLog);
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
        return;
      }
      reject(new Error(formatYtDlpError(code, log)));
    });
  });
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

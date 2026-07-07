import fs from 'node:fs';
import path from 'node:path';
import type { MediaCandidate } from '../../shared/types.js';
import type { AppConfig } from '../config/appConfig.js';
import type { BrowserAnalyzer } from '../browser-analyzer/browserAnalyzer.js';
import type { CategoryService } from '../categories/categoryService.js';
import type { DownloadEngine } from '../download-engine/downloadEngine.js';
import type { MediaFiles } from '../media-library/mediaFiles.js';
import type { MediaLibraryService } from '../media-library/mediaLibraryService.js';
import type { MediaProcessor } from '../media-processing/mediaProcessor.js';
import { NoopSourceExtractor, type SourceExtractor } from '../source-extractors/sourceExtractorService.js';
import { JobCanceledError, isCancellationError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { titleFromUrl } from '../utils/fileSafety.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';
import type { JobService } from './jobService.js';

class DownloadStalledError extends Error {
  constructor(jobId: string, timeoutMs: number, progress: number) {
    super(`Download stalled for ${Math.round(timeoutMs / 1000)}s without progress (job ${jobId}, last progress ${Math.round(progress * 100)}%).`);
    this.name = 'DownloadStalledError';
  }
}

export class QueueRunner {
  private readonly activeControllers = new Map<string, AbortController>();
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobService,
    private readonly analyzer: BrowserAnalyzer,
    private readonly downloader: DownloadEngine,
    private readonly processor: MediaProcessor,
    private readonly categories: CategoryService,
    private readonly mediaFiles: MediaFiles,
    private readonly mediaLibrary: MediaLibraryService,
    private readonly sourceExtractors: SourceExtractor = new NoopSourceExtractor()
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 1500);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  cancel(jobId: string) {
    this.activeControllers.get(jobId)?.abort();
    return this.jobs.cancel(jobId);
  }

  delete(jobId: string): void {
    this.activeControllers.get(jobId)?.abort();
    cleanupJobArtifacts(this.config, jobId);
    this.jobs.delete(jobId);
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    const job = this.jobs.nextRunnableJob();
    if (!job) {
      return;
    }

    this.running = true;
    try {
      await this.process(job.id);
    } finally {
      this.running = false;
    }
  }

  private async process(jobId: string): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(jobId, controller);
    const signal = controller.signal;
    let workDir: string | null = null;
    let finalPath: string | null = null;
    let thumbnailPath: string | null = null;
    try {
      this.throwIfCanceled(jobId, signal);
      let job = this.jobs.transition(jobId, 'analyzing', 0.05);
      logJobEvent('info', 'job-started', { jobId, source: safeUrlParts(job.sourceUrl) });
      const category = this.categories.get(job.categoryId);
      if (!category) {
        throw new Error('Job category does not exist');
      }

      const useSourceExtractor = this.sourceExtractors.canHandle(job.sourceUrl);
      let selected: MediaCandidate | null = null;
      if (!useSourceExtractor) {
        const existingCandidates = this.jobs.listCandidates(job.id);
        selected = job.selectedCandidateId ? existingCandidates.find((candidate) => candidate.id === job.selectedCandidateId) ?? null : null;
      }
      if (!useSourceExtractor && !selected) {
        const analysis = await this.analyzer.analyze(job.sourceUrl, job.id, signal);
        this.throwIfCanceled(job.id, signal);
        const candidates = this.jobs.saveCandidates(job.id, analysis.candidates);
        job = this.jobs.transition(job.id, 'analyzing', 0.18, { titleHint: analysis.titleHint ?? titleFromUrl(job.sourceUrl) });
        selected = chooseAutomaticCandidate(candidates);
        if (!selected) {
          this.jobs.transition(job.id, 'needs_manual_selection', 0.2, {
            errorCode: 'manual_selection_required',
            errorMessage: analysis.diagnostics.join('\n') || 'Choose a detected media candidate to continue.'
          });
          logJobEvent('warn', 'job-needs-manual-selection', {
            candidates: candidates.length,
            jobId: job.id,
            source: safeUrlParts(job.sourceUrl)
          });
          return;
        }
      }

      this.throwIfCanceled(job.id, signal);
      const selectedCandidateId = selected?.id ?? job.selectedCandidateId;
      job = this.jobs.transition(job.id, 'downloading', 0.22, { selectedCandidateId });
      workDir = path.join(this.config.workRoot, job.id);
      fs.mkdirSync(workDir, { recursive: true });
      const downloadPath = path.join(workDir, 'source');
      logJobEvent('info', 'download-started', {
        candidate: selected ? candidateLogFields(selected) : { extractor: 'source' },
        jobId: job.id,
        timeoutSeconds: Math.round(downloadStallTimeoutMs(this.config) / 1000)
      });
      if (useSourceExtractor) {
        await this.runDownloadStage(job.id, signal, (onProgress, downloadSignal) =>
          this.sourceExtractors.download(job.sourceUrl, downloadPath, onProgress, downloadSignal)
        );
      } else {
        if (!selected) {
          throw new Error('No selected media candidate is available for download');
        }
        await this.runDownloadStage(job.id, signal, (onProgress, downloadSignal) =>
          this.downloader.download(selected, downloadPath, onProgress, downloadSignal)
        );
      }

      this.throwIfCanceled(job.id, signal);
      this.jobs.transition(job.id, 'processing', 0.82, { selectedCandidateId });
      logJobEvent('info', 'processing-started', { jobId: job.id });
      const title = job.titleHint ?? titleFromUrl(job.sourceUrl);
      finalPath = this.mediaFiles.finalVideoPath(category, `${title}.mp4`);
      const mediaId = job.id;
      thumbnailPath = this.mediaFiles.thumbnailPath(mediaId);
      const normalized = await this.processor.normalize(downloadPath, finalPath, thumbnailPath, (progress) => {
        this.transitionIfRunning(job.id, 'processing', 0.82 + progress * 0.16, { selectedCandidateId }, signal);
      }, signal);

      this.throwIfCanceled(job.id, signal);
      this.mediaLibrary.create({
        categoryId: category.id,
        title,
        sourceUrl: job.sourceUrl,
        finalFilePath: normalized.outputPath,
        thumbnailPath: normalized.thumbnailPath,
        durationSeconds: normalized.durationSeconds,
        width: normalized.width,
        height: normalized.height,
        sizeBytes: normalized.sizeBytes,
        container: normalized.container,
        videoCodec: normalized.videoCodec,
        audioCodec: normalized.audioCodec
      });

      fs.rmSync(workDir, { recursive: true, force: true });
      this.jobs.transition(job.id, 'completed', 1, { selectedCandidateId });
      logJobEvent('info', 'job-completed', { jobId: job.id, title });
    } catch (error) {
      if (isCancellationError(error) || signal.aborted || this.jobs.get(jobId)?.status === 'canceled' || !this.jobs.get(jobId)) {
        cleanupCanceledArtifacts(workDir, finalPath, thumbnailPath);
        if (this.jobs.get(jobId)) {
          this.jobs.cancel(jobId);
        }
        logJobEvent('info', 'job-canceled', { jobId });
        return;
      }
      if (!this.jobs.get(jobId)) {
        return;
      }
      this.jobs.transition(jobId, 'failed', 0, {
        errorCode: 'pipeline_failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      logJobEvent('error', 'job-failed', { error: shortMessage(error), jobId });
    } finally {
      if (this.activeControllers.get(jobId) === controller) {
        this.activeControllers.delete(jobId);
      }
    }
  }

  private transitionIfRunning(
    jobId: string,
    status: Parameters<JobService['transition']>[1],
    progress: number,
    extra: Parameters<JobService['transition']>[3],
    signal: AbortSignal
  ): void {
    const job = this.jobs.get(jobId);
    if (signal.aborted || !job || job.status === 'canceled') {
      return;
    }
    this.jobs.transition(jobId, status, progress, extra);
  }

  private async runDownloadStage<T>(
    jobId: string,
    parentSignal: AbortSignal,
    run: (onProgress: (progress: number) => void, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const downloadController = new AbortController();
    const timeoutMs = downloadStallTimeoutMs(this.config);
    let lastProgress = 0;
    let lastLoggedBucket = -1;
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;

    const clearTimer = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
    let finishReject: (reason?: unknown) => void = () => undefined;
    const resetTimer = () => {
      clearTimer();
      timeout = setTimeout(() => {
        const error = new DownloadStalledError(jobId, timeoutMs, lastProgress);
        logJobEvent('warn', 'download-stalled', {
          jobId,
          lastProgress: progressForLog(lastProgress),
          timeoutSeconds: Math.round(timeoutMs / 1000)
        });
        downloadController.abort();
        finishReject(error);
      }, timeoutMs);
    };

    return await new Promise<T>((resolve, reject) => {
      let removeParentAbortListener: () => void = () => undefined;
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimer();
        removeParentAbortListener();
        callback();
      };
      finishReject = (error) => settle(() => reject(error));
      removeParentAbortListener = onAbort(parentSignal, () => {
        downloadController.abort();
        finishReject(new JobCanceledError());
      });
      const onProgress = (progress: number) => {
        const nextProgress = clamp01(progress);
        const advanced = nextProgress > lastProgress + 0.001;
        lastProgress = Math.max(lastProgress, nextProgress);
        const overallProgress = 0.22 + lastProgress * 0.55;
        this.transitionIfRunning(jobId, 'downloading', overallProgress, {}, parentSignal);
        const bucket = Math.floor(lastProgress * 10);
        if (bucket !== lastLoggedBucket || lastProgress >= 0.95) {
          lastLoggedBucket = bucket;
          logJobEvent('info', 'download-progress', { jobId, progress: progressForLog(lastProgress) });
        }
        if (advanced) {
          resetTimer();
        }
      };

      resetTimer();
      run(onProgress, downloadController.signal).then(
        (result) => settle(() => resolve(result)),
        (error) => settle(() => reject(error))
      );
    });
  }

  private throwIfCanceled(jobId: string, signal: AbortSignal): void {
    throwIfAborted(signal);
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'canceled') {
      throw new JobCanceledError();
    }
  }
}

function candidateLogFields(candidate: MediaCandidate): Record<string, unknown> {
  return {
    confidence: candidate.confidence,
    contentType: candidate.contentType,
    headerKeys: Object.keys(candidate.headers).filter((key) => key.toLowerCase() !== 'cookie').sort(),
    kind: candidate.kind,
    manifestType: candidate.manifestType,
    url: safeUrlParts(candidate.url)
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function progressForLog(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function downloadStallTimeoutMs(config: AppConfig): number {
  return config.downloadStallTimeoutMs ?? 120_000;
}

function chooseAutomaticCandidate(candidates: MediaCandidate[]): MediaCandidate | null {
  const confident = candidates.filter((candidate) => candidate.confidence >= 0.85);
  if (confident.length === 1) {
    return confident[0];
  }
  const direct = confident.find((candidate) => candidate.kind === 'direct');
  return direct ?? null;
}

function cleanupCanceledArtifacts(workDir: string | null, finalPath: string | null, thumbnailPath: string | null): void {
  for (const filePath of [finalPath, thumbnailPath]) {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  if (workDir && fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function cleanupJobArtifacts(config: AppConfig, jobId: string): void {
  const paths = [
    path.join(config.workRoot, jobId),
    path.join(config.appDataRoot, 'manual-screenshots', `${jobId}.png`),
    path.join(config.appDataRoot, 'live-browser-profiles', jobId),
    path.join(config.thumbnailsRoot, `${jobId}.jpg`)
  ];
  for (const artifactPath of paths) {
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { recursive: true, force: true });
    }
  }
}

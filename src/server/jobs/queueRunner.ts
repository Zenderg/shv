import fs from 'node:fs';
import path from 'node:path';
import type { Category, DownloadJob, MediaCandidate } from '../../shared/types.js';
import type { AppConfig } from '../config/appConfig.js';
import type { BrowserAnalyzer } from '../browser-analyzer/browserAnalyzer.js';
import type { CategoryService } from '../categories/categoryService.js';
import type { DownloadEngine } from '../download-engine/downloadEngine.js';
import type { MediaFiles, ReservedVideoPath } from '../media-library/mediaFiles.js';
import type { MediaLibraryService } from '../media-library/mediaLibraryService.js';
import type { MediaProcessor } from '../media-processing/mediaProcessor.js';
import { NoopSourceExtractor, type SourceExtractor } from '../source-extractors/sourceExtractorService.js';
import { JobCanceledError, isCancellationError, throwIfAborted } from '../utils/cancellation.js';
import { titleFromUrl } from '../utils/fileSafety.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';
import { PublicMediaSession } from '../utils/publicHttpProxy.js';
import { classifyJobFailure, type FailingJobStage } from './jobFailure.js';
import { cleanupCanceledArtifacts, cleanupCompletedWorkDir, cleanupJobArtifacts } from './jobArtifacts.js';
import { runMonitoredJobStage } from './jobProgressMonitor.js';
import type { JobService } from './jobService.js';
import {
  downloadSelectedSubtitleTracks,
  subtitleTracksForDownload,
  type PublicMediaSessionFactory
} from './subtitleDownload.js';

export class QueueRunner {
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly maxConcurrentJobs: number;
  private draining: Promise<void> | null = null;
  private started = false;
  private wakeRequested = false;

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobService,
    private readonly analyzer: BrowserAnalyzer,
    private readonly downloader: DownloadEngine,
    private readonly processor: MediaProcessor,
    private readonly categories: CategoryService,
    private readonly mediaFiles: MediaFiles,
    private readonly mediaLibrary: MediaLibraryService,
    private readonly sourceExtractors: SourceExtractor = new NoopSourceExtractor(),
    private readonly createMediaSession: PublicMediaSessionFactory = () => PublicMediaSession.start()
  ) {
    this.maxConcurrentJobs = config.maxConcurrentJobs ?? 2;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (process.env.PRESERVE_WORK_DIR !== '1') {
      for (const jobId of this.jobs.listCompletedJobIds()) {
        cleanupCompletedWorkDir(this.config, jobId);
      }
    }
    this.jobs.on('runnable', this.requestDrain);
    this.requestDrain();
  }

  stop(): void {
    this.started = false;
    this.jobs.off('runnable', this.requestDrain);
  }

  cancel(jobId: string) {
    this.activeControllers.get(jobId)?.abort();
    return this.jobs.cancel(jobId);
  }

  async retry(jobId: string) {
    await this.abortAndWait(jobId);
    return this.jobs.retry(jobId);
  }

  async replaceSource(jobId: string, sourceUrl: string) {
    await this.abortAndWait(jobId);
    this.removeOwnedOutput(jobId);
    return this.jobs.replaceSource(jobId, sourceUrl);
  }

  async delete(jobId: string): Promise<void> {
    await this.abortAndWait(jobId);
    this.removeOwnedOutput(jobId);
    cleanupJobArtifacts(this.config, jobId);
    this.jobs.delete(jobId);
  }

  async tick(): Promise<void> {
    await Promise.all(this.startAvailableJobs());
  }

  private readonly requestDrain = (): void => {
    if (!this.started) {
      return;
    }
    this.wakeRequested = true;
    if (this.draining) {
      return;
    }
    this.draining = Promise.resolve().then(() => this.drain()).finally(() => {
      this.draining = null;
      if (this.wakeRequested) {
        this.requestDrain();
      }
    });
  };

  private drain(): void {
    do {
      this.wakeRequested = false;
      this.startAvailableJobs();
    } while (this.started && this.wakeRequested);
  }

  private startAvailableJobs(): Promise<void>[] {
    const started: Promise<void>[] = [];
    while (this.activeControllers.size < this.maxConcurrentJobs) {
      const claimed = this.jobs.claimNextRunnableJob();
      if (!claimed) {
        break;
      }
      const run = this.process(claimed.job.id, claimed.runId, claimed.job).finally(() => {
        if (this.activeRuns.get(claimed.job.id) === run) {
          this.activeRuns.delete(claimed.job.id);
        }
        this.requestDrain();
      });
      this.activeRuns.set(claimed.job.id, run);
      started.push(run);
    }
    return started;
  }

  private async process(jobId: string, runId: string, claimedJob: DownloadJob): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(jobId, controller);
    const signal = controller.signal;
    let workDir: string | null = null;
    let finalPath: string | null = null;
    let thumbnailPath: string | null = null;
    let finalPathReservation: ReservedVideoPath | null = null;
    let failingStage: FailingJobStage = 'analyzing';
    try {
      this.throwIfRunInactive(jobId, runId, signal);
      let job = claimedJob;
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
        this.throwIfRunInactive(job.id, runId, signal);
        const candidates = this.jobs.saveCandidates(job.id, analysis.candidates);
        job = this.jobs.transitionActive(job.id, runId, 'analyzing', 'analyzing', null, {
          progressLabel: 'Analyzing source',
          titleHint: analysis.titleHint ?? titleFromUrl(job.sourceUrl)
        });
        selected = chooseAutomaticCandidate(candidates, analysis.automaticCandidateUrl);
        if (!selected) {
          this.jobs.transitionActive(job.id, runId, 'analyzing', 'needs_manual_selection', null, {
            errorCode: 'manual_selection_required',
            errorMessage: analysis.diagnostics.join('\n') || 'Choose a detected media candidate to continue.',
            progressLabel: null
          });
          logJobEvent('warn', 'job-needs-manual-selection', {
            candidates: candidates.length,
            jobId: job.id,
            source: safeUrlParts(job.sourceUrl)
          });
          return;
        }
      }

      this.throwIfRunInactive(job.id, runId, signal);
      const selectedCandidateId = selected?.id ?? job.selectedCandidateId;
      job = this.jobs.transitionActive(job.id, runId, 'analyzing', 'downloading', null, {
        progressLabel: 'Downloading',
        selectedCandidateId
      });
      failingStage = 'downloading';
      workDir = path.join(this.config.workRoot, job.id);
      fs.mkdirSync(workDir, { recursive: true });
      const downloadPath = path.join(workDir, 'source');
      const stallTimeoutMs = this.config.downloadStallTimeoutMs ?? 120_000;
      logJobEvent('info', 'download-started', {
        candidate: selected ? candidateLogFields(selected) : { extractor: 'source' },
        jobId: job.id,
        timeoutSeconds: Math.round(stallTimeoutMs / 1000)
      });
      if (useSourceExtractor) {
        await runMonitoredJobStage({
          eventName: 'download',
          jobId: job.id,
          jobs: this.jobs,
          logDeterminateProgress: true,
          run: (onProgress, downloadSignal) => this.sourceExtractors.download(job.sourceUrl, downloadPath, onProgress, downloadSignal),
          runId,
          signal,
          stallKind: 'network',
          status: 'downloading',
          taskLabel: 'Download',
          timeoutMs: stallTimeoutMs
        });
      } else {
        if (!selected) {
          throw new Error('No selected media candidate is available for download');
        }
        await runMonitoredJobStage({
          eventName: 'download',
          jobId: job.id,
          jobs: this.jobs,
          logDeterminateProgress: true,
          run: (onProgress, downloadSignal) => this.downloader.download(selected, downloadPath, onProgress, downloadSignal),
          runId,
          signal,
          stallKind: 'network',
          status: 'downloading',
          taskLabel: 'Download',
          timeoutMs: stallTimeoutMs
        });
      }

      this.throwIfRunInactive(job.id, runId, signal);
      failingStage = 'processing';
      await runMonitoredJobStage({
        eventName: 'download-probe',
        jobId: job.id,
        jobs: this.jobs,
        run: async (onProgress, probeSignal) => {
          onProgress({ kind: 'activity', label: 'Inspecting downloaded video' });
          await this.logProbeResult('download-probed', job.id, downloadPath, probeSignal);
        },
        runId,
        signal,
        stallKind: 'processing',
        status: 'downloading',
        taskLabel: 'Media inspection',
        timeoutMs: stallTimeoutMs
      });
      if (process.env.PRESERVE_WORK_DIR === '1') {
        fs.copyFileSync(downloadPath, `${downloadPath}.preserved`);
        logJobEvent('info', 'download-preserved', { jobId: job.id, path: `${downloadPath}.preserved` });
      }
      this.jobs.transitionActive(job.id, runId, 'downloading', 'processing', null, {
        progressLabel: 'Inspecting video',
        selectedCandidateId
      });
      logJobEvent('info', 'processing-started', { jobId: job.id });
      const title = job.titleHint ?? titleFromUrl(job.sourceUrl);
      finalPathReservation = this.reserveOutputPath(job.id, runId, category, `${title}.mp4`);
      const processingOutputPath = finalPathReservation.path;
      finalPath = processingOutputPath;
      const mediaId = job.id;
      const processingThumbnailPath = this.mediaFiles.thumbnailPath(mediaId);
      thumbnailPath = processingThumbnailPath;
      const normalized = await runMonitoredJobStage({
        eventName: 'processing',
        jobId: job.id,
        jobs: this.jobs,
        run: (onProgress, processingSignal) => this.processor.normalize(
          downloadPath,
          processingOutputPath,
          processingThumbnailPath,
          onProgress,
          processingSignal
        ),
        runId,
        signal,
        stallKind: 'processing',
        status: 'processing',
        taskLabel: 'Media processing',
        timeoutMs: stallTimeoutMs
      });
      const hasSelectedSubtitles = selected ? subtitleTracksForDownload(selected).length > 0 : false;
      if (hasSelectedSubtitles) {
        this.jobs.transitionActive(job.id, runId, 'processing', 'adding_subtitles', null, {
          progressLabel: 'Downloading subtitles',
          selectedCandidateId
        });
        failingStage = 'adding_subtitles';
      }
      const subtitleWorkDir = workDir;
      if (!subtitleWorkDir) {
        throw new Error('Job work directory is unavailable during subtitle processing');
      }
      const subtitleTracks = selected && hasSelectedSubtitles
        ? await runMonitoredJobStage({
            eventName: 'subtitle-download',
            jobId: job.id,
            jobs: this.jobs,
            run: (onProgress, subtitleSignal) => downloadSelectedSubtitleTracks({
              candidate: selected,
              createMediaSession: this.createMediaSession,
              onProgress,
              signal: subtitleSignal,
              workDir: subtitleWorkDir
            }),
            runId,
            signal,
            stallKind: 'network',
            status: 'adding_subtitles',
            taskLabel: 'Subtitle download',
            timeoutMs: stallTimeoutMs
          })
        : [];
      const processed = subtitleTracks.length > 0
        ? {
            ...normalized,
            ...(await runMonitoredJobStage({
              eventName: 'subtitle-processing',
              jobId: job.id,
              jobs: this.jobs,
              run: (onProgress, subtitleSignal) => this.processor.burnSubtitle(
                normalized.outputPath,
                subtitleTracks[0],
                onProgress,
                subtitleSignal
              ),
              runId,
              signal,
              stallKind: 'processing',
              status: 'adding_subtitles',
              taskLabel: 'Subtitle processing',
              timeoutMs: stallTimeoutMs
            }))
          }
        : normalized;
      logJobEvent('info', 'processing-completed', {
        audioCodec: processed.audioCodec,
        container: processed.container,
        durationSeconds: processed.durationSeconds,
        jobId: job.id,
        processingStrategy: processed.processingStrategy,
        remuxRejectionReason: processed.remuxRejectionReason,
        sizeBytes: processed.sizeBytes,
        subtitleTrackCount: subtitleTracks.length,
        videoCodec: processed.videoCodec
      });

      this.throwIfRunInactive(job.id, runId, signal);
      failingStage = 'finalizing';
      this.mediaLibrary.completeJob(job.id, runId, {
        categoryId: category.id,
        title,
        sourceUrl: job.sourceUrl,
        finalFilePath: processed.outputPath,
        thumbnailPath: processed.thumbnailPath,
        durationSeconds: processed.durationSeconds,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.sizeBytes,
        container: processed.container,
        videoCodec: processed.videoCodec,
        audioCodec: processed.audioCodec
      });

      if (process.env.PRESERVE_WORK_DIR === '1') {
        logJobEvent('info', 'work-dir-preserved', { jobId: job.id, workDir });
      } else {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      logJobEvent('info', 'job-completed', { jobId: job.id, title });
    } catch (error) {
      const persistedJob = this.jobs.get(jobId);
      if (persistedJob?.status === 'completed') {
        logJobEvent('warn', 'job-completed-cleanup-failed', { error: shortMessage(error), jobId });
        return;
      }
      const activeStatus = this.jobs.activeRunStatus(jobId, runId);
      if (isCancellationError(error) || signal.aborted || !activeStatus || persistedJob?.status === 'canceled') {
        cleanupCanceledArtifacts(this.config, jobId, finalPath, thumbnailPath);
        if (activeStatus) {
          this.jobs.cancel(jobId);
        }
        logJobEvent('info', 'job-canceled', { jobId });
        return;
      }
      this.jobs.transitionActive(jobId, runId, activeStatus, 'failed', null, {
        errorCode: classifyJobFailure(failingStage, error),
        errorMessage: error instanceof Error ? error.message : String(error),
        progressLabel: null
      });
      logJobEvent('error', 'job-failed', { error: shortMessage(error), jobId });
    } finally {
      finalPathReservation?.release();
      if (this.activeControllers.get(jobId) === controller) {
        this.activeControllers.delete(jobId);
      }
    }
  }

  private async abortAndWait(jobId: string): Promise<void> {
    const run = this.activeRuns.get(jobId);
    this.activeControllers.get(jobId)?.abort();
    await run;
  }

  private throwIfRunInactive(jobId: string, runId: string, signal: AbortSignal): void {
    throwIfAborted(signal);
    if (!this.jobs.isActiveRun(jobId, runId)) {
      throw new JobCanceledError();
    }
  }

  private reserveOutputPath(jobId: string, runId: string, category: Category, desiredFilename: string): ReservedVideoPath {
    const existingRelativePath = this.jobs.outputRelativePath(jobId);
    if (existingRelativePath) {
      return this.mediaFiles.reserveVideoPath(this.mediaFiles.absoluteMediaPath(existingRelativePath));
    }

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const externallyReserved = new Set(
        this.jobs.reservedOutputRelativePaths().map((relativePath) => this.mediaFiles.absoluteMediaPath(relativePath))
      );
      const reservation = this.mediaFiles.reserveFinalVideoPath(category, desiredFilename, externallyReserved);
      const relativePath = this.mediaFiles.relativeMediaPath(reservation.path);
      const stored = this.jobs.reserveOutputPath(jobId, runId, relativePath);
      if (stored.reserved && stored.relativePath === relativePath) {
        return reservation;
      }
      reservation.release();
      if (stored.relativePath) {
        return this.mediaFiles.reserveVideoPath(this.mediaFiles.absoluteMediaPath(stored.relativePath));
      }
    }
    throw new Error(`Unable to reserve a durable output path for job ${jobId}`);
  }

  private removeOwnedOutput(jobId: string): void {
    const relativePath = this.jobs.outputRelativePath(jobId);
    if (!relativePath) {
      return;
    }
    fs.rmSync(this.mediaFiles.absoluteMediaPath(relativePath), { force: true });
  }

  private async logProbeResult(event: string, jobId: string, filePath: string, signal: AbortSignal): Promise<void> {
    try {
      const probe = await this.processor.probe(filePath, signal);
      logJobEvent('info', event, {
        audioCodec: probe.audioCodec,
        browserFriendly: probe.browserFriendly,
        container: probe.container,
        durationSeconds: probe.durationSeconds,
        jobId,
        sizeBytes: probe.sizeBytes,
        videoCodec: probe.videoCodec
      });
    } catch (error) {
      if (signal.aborted || isCancellationError(error)) {
        throw error;
      }
      logJobEvent('warn', `${event}-failed`, { error: shortMessage(error), jobId });
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
    subtitleTrackCount: candidate.subtitleTracks.length,
    url: safeUrlParts(candidate.url)
  };
}

function chooseAutomaticCandidate(candidates: MediaCandidate[], automaticCandidateUrl: string | null): MediaCandidate | null {
  if (!automaticCandidateUrl) {
    return null;
  }
  const confident = candidates.filter((candidate) => candidate.confidence >= 0.85);
  return confident.find((candidate) => isSameSourceUrl(candidate.url, automaticCandidateUrl)) ?? null;
}

function isSameSourceUrl(candidateUrl: string, sourceUrl: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const source = new URL(sourceUrl);
    candidate.hash = '';
    source.hash = '';
    return candidate.href === source.href;
  } catch {
    return candidateUrl === sourceUrl;
  }
}

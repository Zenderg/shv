import fs from 'node:fs';
import path from 'node:path';
import type { Category, DownloadJob, MediaCandidate, SubtitleTrack } from '../../shared/types.js';
import type { AppConfig } from '../config/appConfig.js';
import type { BrowserAnalyzer } from '../browser-analyzer/browserAnalyzer.js';
import type { CategoryService } from '../categories/categoryService.js';
import type { DownloadEngine } from '../download-engine/downloadEngine.js';
import type { MediaFiles, ReservedVideoPath } from '../media-library/mediaFiles.js';
import type { MediaLibraryService } from '../media-library/mediaLibraryService.js';
import type { MediaProcessor } from '../media-processing/mediaProcessor.js';
import { NoopSourceExtractor, type SourceExtractor } from '../source-extractors/sourceExtractorService.js';
import { JobCanceledError, isCancellationError, onAbort, throwIfAborted } from '../utils/cancellation.js';
import { requestHeadersForUrl } from '../utils/downloadRequestHeaders.js';
import { assertInsideRoot, titleFromUrl } from '../utils/fileSafety.js';
import { logJobEvent, safeUrlParts, shortMessage } from '../utils/jobLogger.js';
import { assertPublicHttpUrlSyntax } from '../utils/networkSafety.js';
import { PublicMediaSession, type PublicMediaSessionLike } from '../utils/publicHttpProxy.js';
import { activityUpdate, progressLogMilestone, progressUpdate, type TaskProgressCallback, type TaskProgressUpdate } from '../utils/taskProgress.js';
import { classifyJobFailure, type FailingJobStage } from './jobFailure.js';
import type { JobService } from './jobService.js';

class DownloadStalledError extends Error {
  constructor(jobId: string, timeoutMs: number, progress: number, taskLabel = 'Download') {
    super(`${taskLabel} stalled for ${Math.round(timeoutMs / 1000)}s without activity (job ${jobId}, last progress ${Math.round(progress * 100)}%).`);
    this.name = 'DownloadStalledError';
  }
}

type PublicMediaSessionFactory = () => Promise<PublicMediaSessionLike>;
type PublicMediaResponse = Awaited<ReturnType<PublicMediaSessionLike['fetch']>>;
const MAX_SUBTITLE_REDIRECTS = 5;
const PROGRESS_PERSIST_INTERVAL_MS = 750;
const PROGRESS_PERSIST_DELTA = 0.01;

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

  delete(jobId: string): void {
    this.activeControllers.get(jobId)?.abort();
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
      logJobEvent('info', 'download-started', {
        candidate: selected ? candidateLogFields(selected) : { extractor: 'source' },
        jobId: job.id,
        timeoutSeconds: Math.round(downloadStallTimeoutMs(this.config) / 1000)
      });
      if (useSourceExtractor) {
        await this.runMonitoredStage(job.id, runId, 'downloading', signal, {
          eventName: 'download',
          logDeterminateProgress: true,
          taskLabel: 'Download'
        }, (onProgress, downloadSignal) =>
          this.sourceExtractors.download(job.sourceUrl, downloadPath, onProgress, downloadSignal)
        );
      } else {
        if (!selected) {
          throw new Error('No selected media candidate is available for download');
        }
        await this.runMonitoredStage(job.id, runId, 'downloading', signal, {
          eventName: 'download',
          logDeterminateProgress: true,
          taskLabel: 'Download'
        }, (onProgress, downloadSignal) =>
          this.downloader.download(selected, downloadPath, onProgress, downloadSignal)
        );
      }

      this.throwIfRunInactive(job.id, runId, signal);
      await this.logProbeResult('download-probed', job.id, downloadPath);
      if (process.env.PRESERVE_WORK_DIR === '1') {
        fs.copyFileSync(downloadPath, `${downloadPath}.preserved`);
        logJobEvent('info', 'download-preserved', { jobId: job.id, path: `${downloadPath}.preserved` });
      }
      this.jobs.transitionActive(job.id, runId, 'downloading', 'processing', null, {
        progressLabel: 'Inspecting video',
        selectedCandidateId
      });
      failingStage = 'processing';
      logJobEvent('info', 'processing-started', { jobId: job.id });
      const title = job.titleHint ?? titleFromUrl(job.sourceUrl);
      finalPathReservation = this.reserveOutputPath(job.id, runId, category, `${title}.mp4`);
      finalPath = finalPathReservation.path;
      const mediaId = job.id;
      thumbnailPath = this.mediaFiles.thumbnailPath(mediaId);
      const processingProgress = this.createProgressReporter(job.id, runId, 'processing', signal);
      const normalized = await this.processor.normalize(downloadPath, finalPath, thumbnailPath, processingProgress, signal);
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
        ? await this.runMonitoredStage(job.id, runId, 'adding_subtitles', signal, {
            eventName: 'subtitle-download',
            taskLabel: 'Subtitle download'
          }, (onProgress, subtitleSignal) => this.downloadSubtitleTracks(selected, subtitleWorkDir, runId, onProgress, subtitleSignal))
        : [];
      const subtitleProgress = hasSelectedSubtitles
        ? this.createProgressReporter(job.id, runId, 'adding_subtitles', signal)
        : null;
      const processed = subtitleTracks.length > 0
        ? {
            ...normalized,
            ...(await this.processor.burnSubtitle(normalized.outputPath, subtitleTracks[0], subtitleProgress ?? (() => undefined), signal))
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

  private createProgressReporter(
    jobId: string,
    runId: string,
    status: Parameters<JobService['updateProgress']>[1],
    signal: AbortSignal
  ): TaskProgressCallback {
    const initial = this.jobs.get(jobId);
    let currentProgress = initial?.stageProgress ?? null;
    let currentLabel = initial?.progressLabel ?? null;
    let lastPersistedProgress = currentProgress;
    let lastPersistedLabel = currentLabel;
    let lastPersistedAt = Date.now();

    return (update: TaskProgressUpdate) => {
      if (signal.aborted) return;

      if (update.label !== undefined && update.label !== currentLabel) {
        currentLabel = update.label;
        currentProgress = null;
      }
      if (update.kind === 'progress') {
        const next = clamp01(update.fraction);
        currentProgress = currentProgress === null ? next : Math.max(currentProgress, next);
      }

      const now = Date.now();
      const labelChanged = currentLabel !== lastPersistedLabel;
      const determinateChanged = (currentProgress === null) !== (lastPersistedProgress === null);
      const progressChanged = currentProgress !== lastPersistedProgress;
      const progressDelta = currentProgress !== null && lastPersistedProgress !== null
        ? currentProgress - lastPersistedProgress
        : 0;
      const shouldPersist = labelChanged
        || determinateChanged
        || progressDelta >= PROGRESS_PERSIST_DELTA
        || currentProgress === 1
        || (progressChanged && now - lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS);
      if (!shouldPersist) return;

      if (this.jobs.updateProgress(jobId, status, runId, currentProgress, currentLabel)) {
        lastPersistedAt = now;
        lastPersistedLabel = currentLabel;
        lastPersistedProgress = currentProgress;
      }
    };
  }

  private async runMonitoredStage<T>(
    jobId: string,
    runId: string,
    status: 'downloading' | 'adding_subtitles',
    parentSignal: AbortSignal,
    options: { eventName: string; logDeterminateProgress?: boolean; taskLabel: string },
    run: (onProgress: TaskProgressCallback, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const downloadController = new AbortController();
    const timeoutMs = downloadStallTimeoutMs(this.config);
    let lastProgress = 0;
    let lastLoggedMilestone = -1;
    let lastActivityAt = Date.now();
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;
    const persistProgress = this.createProgressReporter(jobId, runId, status, parentSignal);

    const clearTimer = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };
    let finishReject: (reason?: unknown) => void = () => undefined;
    const scheduleWatchdog = (delayMs = timeoutMs) => {
      clearTimer();
      timeout = setTimeout(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs < timeoutMs) {
          scheduleWatchdog(timeoutMs - idleMs);
          return;
        }
        const error = new DownloadStalledError(jobId, timeoutMs, lastProgress, options.taskLabel);
        logJobEvent('warn', `${options.eventName}-stalled`, {
          jobId,
          lastProgress: progressForLog(lastProgress),
          timeoutSeconds: Math.round(timeoutMs / 1000)
        });
        downloadController.abort();
        finishReject(error);
      }, Math.max(1, delayMs));
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
      const onProgress: TaskProgressCallback = (update) => {
        lastActivityAt = Date.now();
        if (update.kind === 'progress') {
          lastProgress = Math.max(lastProgress, clamp01(update.fraction));
          persistProgress({ ...update, fraction: lastProgress });
          const milestone = progressLogMilestone(lastProgress);
          if (options.logDeterminateProgress && milestone > lastLoggedMilestone) {
            lastLoggedMilestone = milestone;
            logJobEvent('info', 'download-progress', { jobId, progress: progressForLog(lastProgress) });
          }
        } else {
          persistProgress(update);
        }
      };

      scheduleWatchdog();
      run(onProgress, downloadController.signal).then(
        (result) => settle(() => resolve(result)),
        (error) => settle(() => reject(error))
      );
    });
  }

  private async downloadSubtitleTracks(
    candidate: MediaCandidate,
    workDir: string,
    runId: string,
    onProgress: TaskProgressCallback,
    signal: AbortSignal
  ): Promise<Array<SubtitleTrack & { localPath: string }>> {
    const tracks = subtitleTracksForDownload(candidate);
    if (tracks.length === 0) {
      return [];
    }
    const subtitleDir = path.join(workDir, 'subtitles');
    fs.mkdirSync(subtitleDir, { recursive: true });
    const downloaded: Array<SubtitleTrack & { localPath: string }> = [];
    const session = await this.createMediaSession();
    try {
      for (const [index, track] of tracks.entries()) {
        this.throwIfRunInactive(candidate.jobId, runId, signal);
        const localPath = path.join(subtitleDir, `subtitle-${index + 1}${subtitleExtension(track)}`);
        if (track.format === 'hls') {
          await downloadHlsSubtitleTrack(track, localPath, candidate.url, candidate.headers, session, onProgress, signal);
        } else {
          await downloadSubtitleFile(track, localPath, candidate.url, candidate.headers, session, onProgress, signal);
        }
        downloaded.push({ ...track, localPath });
        logJobEvent('info', 'subtitle-downloaded', {
          format: track.format,
          jobId: candidate.jobId,
          label: track.label,
          language: track.language,
          source: track.source
        });
      }
    } finally {
      await session.close();
    }
    return downloaded;
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

  private async logProbeResult(event: string, jobId: string, filePath: string): Promise<void> {
    try {
      const probe = await this.processor.probe(filePath);
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

export function subtitleTracksForDownload(candidate: MediaCandidate): SubtitleTrack[] {
  const supported = candidate.subtitleTracks.filter((track) => ['webvtt', 'srt', 'ass', 'hls'].includes(track.format));
  const selected = supported.find((track) => track.isSelected === true);
  return selected ? [selected] : [];
}

function subtitleExtension(track: SubtitleTrack): string {
  if (track.format === 'srt') {
    return '.srt';
  }
  if (track.format === 'ass') {
    return '.ass';
  }
  if (track.format === 'hls') {
    return '.m3u8';
  }
  return '.vtt';
}

async function downloadSubtitleFile(
  track: SubtitleTrack,
  localPath: string,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  session: PublicMediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<void> {
  const body = await fetchSubtitleBinary(
    track,
    candidateUrl,
    candidateHeaders,
    track.url,
    session,
    onProgress,
    signal
  );
  fs.writeFileSync(localPath, body);
}

async function downloadHlsSubtitleTrack(
  track: SubtitleTrack,
  localPath: string,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  session: PublicMediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<void> {
  const manifest = await fetchSubtitleText(
    track,
    candidateUrl,
    candidateHeaders,
    track.url,
    session,
    onProgress,
    signal
  );
  const baseUrl = track.url;
  const directory = path.dirname(localPath);
  const segmentLines = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  let segmentIndex = 0;
  const rewrittenLines: string[] = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      rewrittenLines.push(line);
      continue;
    }
    segmentIndex += 1;
    const segmentUrl = assertPublicHttpUrlSyntax(new URL(trimmed, baseUrl).toString());
    const segmentExtension = path.extname(new URL(segmentUrl).pathname) || '.vtt';
    const segmentName = `subtitle-segment-${segmentIndex}${segmentExtension}`;
    const segmentPath = path.join(directory, segmentName);
    const body = await fetchSubtitleBinary(
      track,
      candidateUrl,
      candidateHeaders,
      segmentUrl,
      session,
      onProgress,
      signal
    );
    fs.writeFileSync(segmentPath, body);
    onProgress(progressUpdate(Math.min(0.99, segmentIndex / segmentLines.length), 'Downloading subtitles'));
    rewrittenLines.push(segmentName);
  }
  if (segmentIndex === 0) {
    throw new Error(`Subtitle HLS playlist did not contain subtitle segments: ${safeUrlParts(track.url).host}${safeUrlParts(track.url).path}`);
  }
  fs.writeFileSync(localPath, `${rewrittenLines.join('\n')}\n`);
}

export function subtitleDownloadHeaders(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  targetUrl: string
): Record<string, string> {
  return {
    ...requestHeadersForUrl(candidateHeaders, candidateUrl, targetUrl),
    ...requestHeadersForUrl(track.headers ?? {}, track.url, targetUrl)
  };
}

async function fetchSubtitleText(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: PublicMediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<string> {
  const response = await fetchSubtitleResponse(track, candidateUrl, candidateHeaders, url, session, signal);
  return (await readSubtitleResponse(response, onProgress, signal)).toString('utf8');
}

async function fetchSubtitleBinary(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: PublicMediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<Buffer> {
  const response = await fetchSubtitleResponse(track, candidateUrl, candidateHeaders, url, session, signal);
  return readSubtitleResponse(response, onProgress, signal);
}

async function readSubtitleResponse(
  response: PublicMediaResponse,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<Buffer> {
  if (!response.body) {
    throw new Error('Subtitle response did not include a body');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let receivedBytes = 0;
  const removeAbortListener = onAbort(signal, () => void reader.cancel().catch(() => undefined));
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      receivedBytes += chunk.byteLength;
      onProgress(
        Number.isFinite(totalBytes) && totalBytes > 0
          ? progressUpdate(Math.min(0.99, receivedBytes / totalBytes), 'Downloading subtitles')
          : activityUpdate()
      );
    }
  } finally {
    removeAbortListener();
  }
  return Buffer.concat(chunks);
}

async function fetchSubtitleResponse(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: PublicMediaSessionLike,
  signal: AbortSignal
) {
  let targetUrl = assertPublicHttpUrlSyntax(url);
  for (let redirectCount = 0; redirectCount <= MAX_SUBTITLE_REDIRECTS; redirectCount += 1) {
    const response = await session.fetch(targetUrl, {
      headers: subtitleDownloadHeaders(track, candidateUrl, candidateHeaders, targetUrl),
      redirect: 'manual',
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Subtitle request failed with HTTP ${response.status}: ${safeUrlParts(targetUrl).host}${safeUrlParts(targetUrl).path}`);
      }
      return response;
    }
    const location = response.headers.get('location');
    if (!location) {
      await response.body?.cancel();
      throw new Error(`Subtitle request returned redirect HTTP ${response.status} without a location`);
    }
    await response.body?.cancel();
    if (redirectCount === MAX_SUBTITLE_REDIRECTS) {
      throw new Error(`Subtitle request exceeded ${MAX_SUBTITLE_REDIRECTS} redirects`);
    }
    targetUrl = assertPublicHttpUrlSyntax(new URL(location, targetUrl).toString());
  }
  throw new Error('Subtitle redirect handling failed unexpectedly');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function progressForLog(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function downloadStallTimeoutMs(config: AppConfig): number {
  return config.downloadStallTimeoutMs ?? 120_000;
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

function cleanupCanceledArtifacts(config: AppConfig, jobId: string, finalPath: string | null, thumbnailPath: string | null): void {
  for (const filePath of [finalPath, thumbnailPath]) {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  cleanupJobArtifacts(config, jobId);
}

function cleanupJobArtifacts(config: AppConfig, jobId: string): void {
  const paths = [
    artifactPath(config.workRoot, jobId),
    artifactPath(path.join(config.appDataRoot, 'manual-screenshots'), `${jobId}.png`),
    artifactPath(path.join(config.appDataRoot, 'live-browser-profiles'), jobId),
    artifactPath(config.thumbnailsRoot, `${jobId}.jpg`)
  ];
  for (const artifactPath of paths) {
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { recursive: true, force: true });
    }
  }
}

function cleanupCompletedWorkDir(config: AppConfig, jobId: string): void {
  const workDir = artifactPath(config.workRoot, jobId);
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function artifactPath(root: string, relativePath: string): string {
  return assertInsideRoot(root, path.join(root, relativePath));
}

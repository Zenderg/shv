import fs from 'node:fs';
import path from 'node:path';
import type { MediaCandidate, SubtitleTrack } from '../../shared/types.js';
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
  private draining: Promise<void> | null = null;
  private running = false;
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
    private readonly sourceExtractors: SourceExtractor = new NoopSourceExtractor()
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
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

  delete(jobId: string): void {
    this.activeControllers.get(jobId)?.abort();
    cleanupJobArtifacts(this.config, jobId);
    this.jobs.delete(jobId);
  }

  async tick(): Promise<void> {
    await this.runNext();
  }

  private readonly requestDrain = (): void => {
    if (!this.started) {
      return;
    }
    this.wakeRequested = true;
    if (this.draining) {
      return;
    }
    this.draining = this.drain().finally(() => {
      this.draining = null;
      if (this.wakeRequested) {
        this.requestDrain();
      }
    });
  };

  private async drain(): Promise<void> {
    do {
      this.wakeRequested = false;
      while (this.started && (await this.runNext())) {
        // Keep draining jobs that were already queued before the previous job completed.
      }
    } while (this.started && this.wakeRequested);
  }

  private async runNext(): Promise<boolean> {
    if (this.running) {
      return false;
    }
    const job = this.jobs.nextRunnableJob();
    if (!job) {
      return false;
    }

    this.running = true;
    try {
      await this.process(job.id);
    } finally {
      this.running = false;
    }
    return true;
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
        selected = chooseAutomaticCandidate(candidates, analysis.automaticCandidateUrl);
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
      await this.logProbeResult('download-probed', job.id, downloadPath);
      if (process.env.PRESERVE_WORK_DIR === '1') {
        fs.copyFileSync(downloadPath, `${downloadPath}.preserved`);
        logJobEvent('info', 'download-preserved', { jobId: job.id, path: `${downloadPath}.preserved` });
      }
      this.jobs.transition(job.id, 'processing', 0.82, { selectedCandidateId });
      logJobEvent('info', 'processing-started', { jobId: job.id });
      const title = job.titleHint ?? titleFromUrl(job.sourceUrl);
      finalPath = this.mediaFiles.finalVideoPath(category, `${title}.mp4`);
      const mediaId = job.id;
      thumbnailPath = this.mediaFiles.thumbnailPath(mediaId);
      const normalized = await this.processor.normalize(downloadPath, finalPath, thumbnailPath, (progress) => {
        this.transitionIfRunning(job.id, 'processing', 0.82 + progress * 0.16, { selectedCandidateId }, signal);
      }, signal);
      const subtitleTracks = selected ? await this.downloadSubtitleTracks(selected, workDir, signal) : [];
      const processed = subtitleTracks.length > 0
        ? {
            ...normalized,
            ...(await this.processor.burnSubtitle(normalized.outputPath, subtitleTracks[0], signal))
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

      this.throwIfCanceled(job.id, signal);
      this.mediaLibrary.create({
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
      this.jobs.transition(job.id, 'completed', 1, { selectedCandidateId });
      logJobEvent('info', 'job-completed', { jobId: job.id, title });
    } catch (error) {
      if (isCancellationError(error) || signal.aborted || this.jobs.get(jobId)?.status === 'canceled' || !this.jobs.get(jobId)) {
        cleanupCanceledArtifacts(this.config, jobId, finalPath, thumbnailPath);
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
        const advanced = nextProgress > lastProgress;
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

  private async downloadSubtitleTracks(
    candidate: MediaCandidate,
    workDir: string,
    signal: AbortSignal
  ): Promise<Array<SubtitleTrack & { localPath: string }>> {
    const tracks = subtitleTracksForDownload(candidate);
    if (tracks.length === 0) {
      return [];
    }
    const subtitleDir = path.join(workDir, 'subtitles');
    fs.mkdirSync(subtitleDir, { recursive: true });
    const downloaded: Array<SubtitleTrack & { localPath: string }> = [];
    for (const [index, track] of tracks.entries()) {
      this.throwIfCanceled(candidate.jobId, signal);
      const localPath = path.join(subtitleDir, `subtitle-${index + 1}${subtitleExtension(track)}`);
      if (track.format === 'hls') {
        await downloadHlsSubtitleTrack(track, localPath, candidate.headers, signal);
      } else {
        await downloadSubtitleFile(track, localPath, candidate.headers, signal);
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
    return downloaded;
  }

  private throwIfCanceled(jobId: string, signal: AbortSignal): void {
    throwIfAborted(signal);
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'canceled') {
      throw new JobCanceledError();
    }
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
  candidateHeaders: Record<string, string>,
  signal: AbortSignal
): Promise<void> {
  const body = await fetchBinary(track.url, subtitleDownloadHeaders(track, candidateHeaders), signal);
  fs.writeFileSync(localPath, body);
}

async function downloadHlsSubtitleTrack(
  track: SubtitleTrack,
  localPath: string,
  candidateHeaders: Record<string, string>,
  signal: AbortSignal
): Promise<void> {
  const manifest = await fetchText(track.url, subtitleDownloadHeaders(track, candidateHeaders), signal);
  const baseUrl = track.url;
  const directory = path.dirname(localPath);
  let segmentIndex = 0;
  const rewrittenLines: string[] = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      rewrittenLines.push(line);
      continue;
    }
    segmentIndex += 1;
    const segmentUrl = new URL(trimmed, baseUrl).toString();
    const segmentExtension = path.extname(new URL(segmentUrl).pathname) || '.vtt';
    const segmentName = `subtitle-segment-${segmentIndex}${segmentExtension}`;
    const segmentPath = path.join(directory, segmentName);
    const body = await fetchBinary(segmentUrl, subtitleDownloadHeaders(track, candidateHeaders), signal);
    fs.writeFileSync(segmentPath, body);
    rewrittenLines.push(segmentName);
  }
  if (segmentIndex === 0) {
    throw new Error(`Subtitle HLS playlist did not contain subtitle segments: ${safeUrlParts(track.url).host}${safeUrlParts(track.url).path}`);
  }
  fs.writeFileSync(localPath, `${rewrittenLines.join('\n')}\n`);
}

function subtitleDownloadHeaders(track: SubtitleTrack, candidateHeaders: Record<string, string>): Record<string, string> {
  return {
    ...candidateHeaders,
    ...(track.headers ?? {})
  };
}

async function fetchText(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    throw new Error(`Subtitle request failed with HTTP ${response.status}: ${safeUrlParts(url).host}${safeUrlParts(url).path}`);
  }
  return response.text();
}

async function fetchBinary(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    throw new Error(`Subtitle request failed with HTTP ${response.status}: ${safeUrlParts(url).host}${safeUrlParts(url).path}`);
  }
  return Buffer.from(await response.arrayBuffer());
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

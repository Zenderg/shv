import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { DownloadJob, JobStatus, MediaCandidate, QueueSnapshot, SubtitleTrack } from '../../shared/types.js';
import { type CandidateDraft } from '../candidate-detection/candidateDetection.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapDownloadJob, mapMediaCandidate } from '../storage/rowMappers.js';
import { canonicalCategoryLabels } from '../utils/mediaLabels.js';

const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['analyzing', 'downloading', 'processing', 'adding_subtitles'];

export class JobStateConflictError extends Error {
  readonly code = 'job_state_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'JobStateConflictError';
  }
}

export interface ClaimedJob {
  job: DownloadJob;
  runId: string;
}

export interface OutputPathReservationResult {
  relativePath: string | null;
  reserved: boolean;
}

export class JobService extends EventEmitter {
  constructor(private readonly db: Db) {
    super();
  }

  create(sourceUrl: string, categoryId: string, labels: string[] = []): DownloadJob {
    const id = uuidv4();
    const now = nowIso();
    const normalizedLabels = canonicalCategoryLabels(this.db, categoryId, labels).map((label) => label.name);
    this.db
      .prepare(
        `INSERT INTO download_jobs (
          id, source_url, category_id, status, progress, labels_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(id, sourceUrl, categoryId, JSON.stringify(normalizedLabels), now, now);
    const job = this.requireJob(id);
    this.emitRunnable();
    return job;
  }

  listVisible(): DownloadJob[] {
    return this.db
      .prepare(
        `SELECT * FROM download_jobs
         WHERE status != 'completed'
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => mapDownloadJob(row as Record<string, unknown>));
  }

  snapshot(): QueueSnapshot {
    const jobs = this.listVisible();
    const candidatesByJobId = Object.fromEntries(jobs.map((job) => [job.id, [] as MediaCandidate[]]));
    const candidateRows = this.db
      .prepare(
        `SELECT media_candidates.*
         FROM media_candidates
         INNER JOIN download_jobs ON download_jobs.id = media_candidates.job_id
         WHERE download_jobs.status != 'completed'
         ORDER BY media_candidates.job_id ASC, media_candidates.confidence DESC, media_candidates.discovered_at ASC`
      )
      .all();
    for (const row of candidateRows) {
      const candidate = mapMediaCandidate(row as Record<string, unknown>);
      candidatesByJobId[candidate.jobId]?.push(candidate);
    }
    return { jobs, candidatesByJobId };
  }

  claimNextRunnableJob(): ClaimedJob | null {
    const runId = uuidv4();
    const now = nowIso();
    const row = this.db
      .prepare(
        `UPDATE download_jobs
         SET status = 'analyzing', active_run_id = ?, progress = 0,
             stage_progress = NULL, progress_label = 'Analyzing source',
             error_code = NULL, error_message = NULL,
             started_at = ?, completed_at = NULL, updated_at = ?
         WHERE id = (
           SELECT id FROM download_jobs
           WHERE status = 'pending' AND active_run_id IS NULL
           ORDER BY created_at ASC
           LIMIT 1
         )
           AND status = 'pending'
           AND active_run_id IS NULL
         RETURNING *`
      )
      .get(runId, now, now);
    return row ? { job: mapDownloadJob(row as Record<string, unknown>), runId } : null;
  }

  nextRunnableJob(): DownloadJob | null {
    const row = this.db
      .prepare("SELECT * FROM download_jobs WHERE status = 'pending' AND active_run_id IS NULL ORDER BY created_at ASC LIMIT 1")
      .get();
    return row ? mapDownloadJob(row as Record<string, unknown>) : null;
  }

  recoverInterruptedJobs(): void {
    const now = nowIso();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db
        .prepare(
          `UPDATE download_jobs
           SET status = 'completed', progress = 1, stage_progress = 1, progress_label = NULL,
               error_code = NULL, error_message = NULL, active_run_id = NULL,
               output_relative_path = NULL, completed_at = COALESCE(completed_at, ?), updated_at = ?
           WHERE status != 'completed'
             AND EXISTS (SELECT 1 FROM media_items WHERE media_items.job_id = download_jobs.id)`
        )
        .run(now, now);
      this.db
        .prepare(
          `UPDATE download_jobs
           SET status = 'pending', progress = 0, stage_progress = NULL, progress_label = NULL,
               error_code = NULL, error_message = NULL, active_run_id = NULL,
               started_at = NULL, completed_at = NULL, updated_at = ?
           WHERE status IN ('analyzing', 'downloading', 'processing', 'adding_subtitles')`
        )
        .run(now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.emitRunnable();
  }

  get(id: string): DownloadJob | null {
    const row = this.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(id);
    return row ? mapDownloadJob(row as Record<string, unknown>) : null;
  }

  requireJob(id: string): DownloadJob {
    const job = this.get(id);
    if (!job) {
      throw new Error('Job not found');
    }
    return job;
  }

  transitionActive(
    id: string,
    runId: string,
    expectedStatus: JobStatus,
    status: JobStatus,
    stageProgress: number | null,
    extra: Partial<DownloadJob> = {}
  ): DownloadJob {
    if (!ACTIVE_JOB_STATUSES.includes(expectedStatus) || !allowedActiveTransition(expectedStatus, status)) {
      throw new Error(`Illegal active job transition from ${expectedStatus} to ${status}`);
    }
    const now = nowIso();
    const existing = this.requireJob(id);
    const startedAt =
      extra.startedAt !== undefined
        ? extra.startedAt
        : status === 'pending' || status === 'needs_subtitle_selection'
          ? null
          : existing.startedAt;
    const completedAt = extra.completedAt !== undefined ? extra.completedAt : isTerminalStatus(status) ? now : null;
    const activeRunId = ACTIVE_JOB_STATUSES.includes(status) ? runId : null;
    const result = this.db
      .prepare(
        `UPDATE download_jobs
         SET status = ?, progress = ?, stage_progress = ?, progress_label = ?,
             title_hint = ?, error_code = ?, error_message = ?,
             selected_candidate_id = ?, started_at = ?, completed_at = ?, active_run_id = ?, updated_at = ?
         WHERE id = ? AND status = ? AND active_run_id = ?`
      )
      .run(
        status,
        stageProgress ?? 0,
        stageProgress,
        extra.progressLabel !== undefined ? extra.progressLabel : existing.progressLabel,
        extra.titleHint ?? existing.titleHint,
        extra.errorCode ?? null,
        extra.errorMessage ?? null,
        extra.selectedCandidateId ?? existing.selectedCandidateId,
        startedAt,
        completedAt,
        activeRunId,
        now,
        id,
        expectedStatus,
        runId
      );
    if (result.changes === 0) {
      throw new JobStateConflictError(`Job ${id} changed while transitioning from ${expectedStatus} to ${status}`);
    }
    const job = this.requireJob(id);
    if (status === 'pending') {
      this.emitRunnable();
    }
    return job;
  }

  updateProgress(
    id: string,
    expectedStatus: JobStatus,
    expectedRunId: string,
    stageProgress: number | null,
    progressLabel: string | null
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE download_jobs
         SET progress = ?, stage_progress = ?, progress_label = ?, updated_at = ?
         WHERE id = ? AND status = ? AND active_run_id = ?`
      )
      .run(stageProgress ?? 0, stageProgress, progressLabel, nowIso(), id, expectedStatus, expectedRunId);
    return result.changes > 0;
  }

  isActiveRun(id: string, runId: string, expectedStatus?: JobStatus): boolean {
    const row = expectedStatus
      ? this.db.prepare('SELECT id FROM download_jobs WHERE id = ? AND active_run_id = ? AND status = ?').get(id, runId, expectedStatus)
      : this.db.prepare('SELECT id FROM download_jobs WHERE id = ? AND active_run_id = ?').get(id, runId);
    return Boolean(row);
  }

  activeRunStatus(id: string, runId: string): JobStatus | null {
    const row = this.db.prepare('SELECT status FROM download_jobs WHERE id = ? AND active_run_id = ?').get(id, runId) as
      | { status?: unknown }
      | undefined;
    return row ? String(row.status) as JobStatus : null;
  }

  reserveOutputPath(id: string, runId: string, relativePath: string): OutputPathReservationResult {
    const result = this.db
      .prepare(
        `UPDATE OR IGNORE download_jobs
         SET output_relative_path = ?, updated_at = ?
         WHERE id = ? AND active_run_id = ? AND status = 'processing' AND output_relative_path IS NULL`
      )
      .run(relativePath, nowIso(), id, runId);
    const row = this.db
      .prepare('SELECT output_relative_path FROM download_jobs WHERE id = ? AND active_run_id = ?')
      .get(id, runId) as { output_relative_path?: unknown } | undefined;
    const stored = row?.output_relative_path == null ? null : String(row.output_relative_path);
    return { relativePath: stored, reserved: result.changes > 0 || stored === relativePath };
  }

  outputRelativePath(id: string): string | null {
    const row = this.db.prepare('SELECT output_relative_path FROM download_jobs WHERE id = ?').get(id) as
      | { output_relative_path?: unknown }
      | undefined;
    return row?.output_relative_path == null ? null : String(row.output_relative_path);
  }

  reservedOutputRelativePaths(): string[] {
    return this.db
      .prepare('SELECT output_relative_path FROM download_jobs WHERE output_relative_path IS NOT NULL')
      .all()
      .map((row) => String((row as { output_relative_path: unknown }).output_relative_path));
  }

  saveCandidates(jobId: string, candidates: CandidateDraft[]): MediaCandidate[] {
    const insert = this.db.prepare(
      `INSERT INTO media_candidates (
        id, job_id, kind, url, content_type, manifest_type, resolution, bitrate,
        duration_seconds, size_bytes, confidence, headers_json, subtitle_tracks_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = nowIso();
    try {
      this.db.exec('BEGIN');
      this.db.prepare('DELETE FROM media_candidates WHERE job_id = ?').run(jobId);
      for (const candidate of dedupeCandidates(candidates)) {
        insert.run(
          uuidv4(),
          jobId,
          candidate.kind,
          candidate.url,
          candidate.contentType,
          candidate.manifestType,
          candidate.resolution,
          candidate.bitrate,
          candidate.durationSeconds,
          candidate.sizeBytes,
          candidate.confidence,
          JSON.stringify(candidate.headers),
          JSON.stringify(normalizeSubtitleTracks(candidate.subtitleTracks)),
          now
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listCandidates(jobId);
  }

  mergeCandidates(jobId: string, candidates: CandidateDraft[]): MediaCandidate[] {
    const existingByUrl = new Map(this.listCandidates(jobId).map((candidate) => [candidate.url, candidate]));
    const insert = this.db.prepare(
      `INSERT INTO media_candidates (
        id, job_id, kind, url, content_type, manifest_type, resolution, bitrate,
        duration_seconds, size_bytes, confidence, headers_json, subtitle_tracks_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const update = this.db.prepare(
      `UPDATE media_candidates
       SET kind = ?, content_type = ?, manifest_type = ?, resolution = ?, bitrate = ?,
           duration_seconds = ?, size_bytes = ?, confidence = ?, headers_json = ?, subtitle_tracks_json = ?, discovered_at = ?
       WHERE id = ?`
    );
    const now = nowIso();
    try {
      this.db.exec('BEGIN');
      for (const candidate of dedupeCandidates(candidates)) {
        const existing = existingByUrl.get(candidate.url);
        if (existing) {
          update.run(
            candidate.kind,
            candidate.contentType,
            candidate.manifestType,
            candidate.resolution,
            candidate.bitrate,
            candidate.durationSeconds,
            candidate.sizeBytes,
            Math.max(existing.confidence, candidate.confidence),
            JSON.stringify({ ...existing.headers, ...candidate.headers }),
            JSON.stringify(mergeSubtitleTracks(existing.subtitleTracks, candidate.subtitleTracks)),
            now,
            existing.id
          );
          continue;
        }
        insert.run(
          uuidv4(),
          jobId,
          candidate.kind,
          candidate.url,
          candidate.contentType,
          candidate.manifestType,
          candidate.resolution,
          candidate.bitrate,
          candidate.durationSeconds,
          candidate.sizeBytes,
          candidate.confidence,
          JSON.stringify(candidate.headers),
          JSON.stringify(normalizeSubtitleTracks(candidate.subtitleTracks)),
          now
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.listCandidates(jobId);
  }

  replaceExtensionCandidates(jobId: string, candidates: CandidateDraft[]): MediaCandidate[] {
    const job = this.requireJob(jobId);
    if (job.selectedCandidateId && ['pending', 'needs_subtitle_selection', 'analyzing', 'downloading', 'processing'].includes(job.status)) {
      return this.listCandidates(jobId);
    }
    return this.saveCandidates(jobId, candidates);
  }

  listCandidates(jobId: string): MediaCandidate[] {
    return this.db
      .prepare('SELECT * FROM media_candidates WHERE job_id = ? ORDER BY confidence DESC, discovered_at ASC')
      .all(jobId)
      .map((row) => mapMediaCandidate(row as Record<string, unknown>));
  }

  selectCandidate(jobId: string, candidateId: string): DownloadJob {
    const candidate = this.listCandidates(jobId).find((item) => item.id === candidateId);
    if (!candidate) {
      throw new Error('Candidate not found for job');
    }
    const status = supportedSubtitleTracks(candidate).length > 0 ? 'needs_subtitle_selection' : 'pending';
    return this.transitionIdle(jobId, ['pending', 'needs_manual_selection', 'failed'], status, null, {
      selectedCandidateId: candidateId,
      errorCode: null,
      errorMessage: null,
      progressLabel: null
    });
  }

  selectSubtitleTrack(jobId: string, subtitleTrackUrl: string | null): DownloadJob {
    const job = this.requireJob(jobId);
    if (!job.selectedCandidateId) {
      throw new Error('Candidate not selected for job');
    }
    const candidate = this.listCandidates(jobId).find((item) => item.id === job.selectedCandidateId);
    if (!candidate) {
      throw new Error('Candidate not found for job');
    }
    const supportedTracks = supportedSubtitleTracks(candidate);
    if (subtitleTrackUrl && !supportedTracks.some((track) => sameUrl(track.url, subtitleTrackUrl))) {
      throw new Error('Subtitle track not found for selected candidate');
    }
    const subtitleTracks = candidate.subtitleTracks.map((track) => ({
      ...track,
      isSelected: subtitleTrackUrl ? sameUrl(track.url, subtitleTrackUrl) : false
    }));
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.updateCandidateSubtitleTracks(candidate.id, subtitleTracks);
      const updated = this.transitionIdle(jobId, ['needs_subtitle_selection'], 'pending', null, {
        selectedCandidateId: candidate.id,
        errorCode: null,
        errorMessage: null,
        progressLabel: null
      });
      this.db.exec('COMMIT');
      return updated;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  replaceSource(jobId: string, sourceUrl: string): DownloadJob {
    const now = nowIso();
    this.requireJob(jobId);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = this.db
        .prepare(
          `UPDATE download_jobs
           SET source_url = ?, selected_candidate_id = NULL, status = 'pending', progress = 0,
               stage_progress = NULL, progress_label = NULL,
               error_code = NULL, error_message = NULL, active_run_id = NULL,
               output_relative_path = NULL, started_at = NULL, completed_at = NULL, updated_at = ?
           WHERE id = ? AND active_run_id IS NULL
             AND status IN ('pending', 'needs_manual_selection', 'needs_subtitle_selection', 'failed', 'canceled')`
        )
        .run(sourceUrl, now, jobId);
      if (result.changes === 0) {
        throw new JobStateConflictError(`Job ${jobId} cannot replace its source in the current state`);
      }
      this.db.prepare('DELETE FROM media_candidates WHERE job_id = ?').run(jobId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const job = this.requireJob(jobId);
    this.emitRunnable();
    return job;
  }

  retry(jobId: string): DownloadJob {
    const now = nowIso();
    this.requireJob(jobId);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = this.db
        .prepare(
          `UPDATE download_jobs
           SET status = 'pending', progress = 0, stage_progress = NULL, progress_label = NULL,
               error_code = NULL, error_message = NULL, active_run_id = NULL,
               selected_candidate_id = NULL, started_at = NULL, completed_at = NULL, updated_at = ?
           WHERE id = ? AND active_run_id IS NULL AND status IN ('failed', 'canceled')`
        )
        .run(now, jobId);
      if (result.changes === 0) {
        throw new JobStateConflictError(`Job ${jobId} cannot be retried in the current state`);
      }
      this.db.prepare('DELETE FROM media_candidates WHERE job_id = ?').run(jobId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const job = this.requireJob(jobId);
    this.emitRunnable();
    return job;
  }

  cancel(jobId: string): DownloadJob {
    const job = this.requireJob(jobId);
    if (job.status === 'canceled') {
      return job;
    }
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE download_jobs
         SET status = 'canceled', progress = ?, stage_progress = ?, progress_label = NULL,
             completed_at = ?, active_run_id = NULL, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'analyzing', 'downloading', 'processing', 'adding_subtitles')`
      )
      .run(job.stageProgress ?? 0, job.stageProgress, now, now, jobId);
    if (result.changes === 0) {
      throw new JobStateConflictError(`Job ${jobId} cannot be canceled in the current state`);
    }
    return this.requireJob(jobId);
  }

  delete(jobId: string): void {
    try {
      this.db.exec('BEGIN');
      this.db.prepare('DELETE FROM media_candidates WHERE job_id = ?').run(jobId);
      this.db.prepare('DELETE FROM download_jobs WHERE id = ?').run(jobId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listCompletedJobIds(): string[] {
    return this.db
      .prepare("SELECT id FROM download_jobs WHERE status = 'completed'")
      .all()
      .map((row) => String((row as { id: unknown }).id));
  }

  private transitionIdle(
    id: string,
    expectedStatuses: readonly JobStatus[],
    status: JobStatus,
    stageProgress: number | null,
    extra: Partial<DownloadJob> = {}
  ): DownloadJob {
    const existing = this.requireJob(id);
    const placeholders = expectedStatuses.map(() => '?').join(', ');
    const now = nowIso();
    const startedAt = status === 'pending' || status === 'needs_subtitle_selection' ? null : existing.startedAt;
    const completedAt = isTerminalStatus(status) ? now : null;
    const result = this.db
      .prepare(
        `UPDATE download_jobs
         SET status = ?, progress = ?, stage_progress = ?, progress_label = ?,
             title_hint = ?, error_code = ?, error_message = ?, selected_candidate_id = ?,
             started_at = ?, completed_at = ?, active_run_id = NULL, updated_at = ?
         WHERE id = ? AND active_run_id IS NULL AND status IN (${placeholders})`
      )
      .run(
        status,
        stageProgress ?? 0,
        stageProgress,
        extra.progressLabel !== undefined ? extra.progressLabel : existing.progressLabel,
        extra.titleHint ?? existing.titleHint,
        extra.errorCode ?? null,
        extra.errorMessage ?? null,
        extra.selectedCandidateId ?? existing.selectedCandidateId,
        startedAt,
        completedAt,
        now,
        id,
        ...expectedStatuses
      );
    if (result.changes === 0) {
      throw new JobStateConflictError(`Job ${id} cannot transition from its current state to ${status}`);
    }
    if (status === 'pending') {
      this.emitRunnable();
    }
    return this.requireJob(id);
  }

  private updateCandidateSubtitleTracks(candidateId: string, tracks: SubtitleTrack[]): void {
    this.db
      .prepare('UPDATE media_candidates SET subtitle_tracks_json = ? WHERE id = ?')
      .run(JSON.stringify(normalizeSubtitleTracks(tracks)), candidateId);
  }

  private emitRunnable(): void {
    this.emit('runnable');
  }
}

function dedupeCandidates(candidates: CandidateDraft[]): CandidateDraft[] {
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()].sort(
    (left, right) => right.confidence - left.confidence
  );
}

function normalizeSubtitleTracks(tracks: SubtitleTrack[] | undefined): SubtitleTrack[] {
  return (tracks ?? []).filter((track) => track?.url).map((track) => ({
    contentType: track.contentType ?? null,
    format: track.format ?? 'unknown',
    isDefault: track.isDefault ?? null,
    isSelected: track.isSelected ?? null,
    label: track.label ?? null,
    language: track.language ?? null,
    source: track.source ?? 'network',
    url: track.url,
    ...(track.headers ? { headers: track.headers } : {})
  }));
}

function mergeSubtitleTracks(existing: SubtitleTrack[], incoming: SubtitleTrack[] | undefined): SubtitleTrack[] {
  const byUrl = new Map(normalizeSubtitleTracks(existing).map((track) => [track.url, track]));
  for (const track of normalizeSubtitleTracks(incoming)) {
    const current = byUrl.get(track.url);
    byUrl.set(track.url, current ? { ...current, ...track, headers: { ...(current.headers ?? {}), ...(track.headers ?? {}) } } : track);
  }
  return [...byUrl.values()];
}

function supportedSubtitleTracks(candidate: MediaCandidate): SubtitleTrack[] {
  return candidate.subtitleTracks.filter((track) => ['webvtt', 'srt', 'ass', 'hls'].includes(track.format));
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function allowedActiveTransition(from: JobStatus, to: JobStatus): boolean {
  const transitions: Partial<Record<JobStatus, readonly JobStatus[]>> = {
    analyzing: ['analyzing', 'needs_manual_selection', 'downloading', 'failed'],
    downloading: ['processing', 'failed'],
    processing: ['adding_subtitles', 'failed'],
    adding_subtitles: ['failed']
  };
  return transitions[from]?.includes(to) ?? false;
}

import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import type { DownloadJob, JobStatus, MediaCandidate, QueueSnapshot, SubtitleTrack } from '../../shared/types.js';
import { type CandidateDraft } from '../candidate-detection/candidateDetection.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapDownloadJob, mapMediaCandidate } from '../storage/rowMappers.js';

export class JobService extends EventEmitter {
  constructor(private readonly db: Db) {
    super();
  }

  create(sourceUrl: string, categoryId: string): DownloadJob {
    const id = uuidv4();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO download_jobs (
          id, source_url, category_id, status, progress, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, ?)`
      )
      .run(id, sourceUrl, categoryId, now, now);
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
    const candidatesByJobId: Record<string, MediaCandidate[]> = {};
    for (const job of jobs) {
      candidatesByJobId[job.id] = this.listCandidates(job.id);
    }
    return { jobs, candidatesByJobId };
  }

  nextRunnableJob(): DownloadJob | null {
    const row = this.db
      .prepare(
        `SELECT * FROM download_jobs
         WHERE status IN ('pending')
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get();
    return row ? mapDownloadJob(row as Record<string, unknown>) : null;
  }

  recoverInterruptedJobs(): void {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE download_jobs
         SET status = 'pending', progress = 0, error_code = NULL, error_message = NULL,
             started_at = NULL, completed_at = NULL, updated_at = ?
         WHERE status IN ('analyzing', 'downloading', 'processing')`
      )
      .run(now);
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

  transition(id: string, status: JobStatus, progress: number, extra: Partial<DownloadJob> = {}): DownloadJob {
    const now = nowIso();
    const existing = this.requireJob(id);
    const startedAt =
      extra.startedAt !== undefined
        ? extra.startedAt
        : status === 'pending' || status === 'needs_subtitle_selection'
          ? null
          : status === 'analyzing' && !existing.startedAt
            ? now
            : existing.startedAt;
    const completedAt =
      extra.completedAt !== undefined ? extra.completedAt : isTerminalStatus(status) ? now : null;
    this.db
      .prepare(
        `UPDATE download_jobs
         SET status = ?, progress = ?, title_hint = ?, error_code = ?, error_message = ?,
             selected_candidate_id = ?, started_at = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        progress,
        extra.titleHint ?? existing.titleHint,
        extra.errorCode ?? null,
        extra.errorMessage ?? null,
        extra.selectedCandidateId ?? existing.selectedCandidateId,
        startedAt,
        completedAt,
        now,
        id
      );
    const job = this.requireJob(id);
    if (status === 'pending') {
      this.emitRunnable();
    }
    return job;
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
    return this.transition(jobId, status, status === 'needs_subtitle_selection' ? 0.21 : 0, {
      selectedCandidateId: candidateId,
      errorCode: null,
      errorMessage: null
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
    this.updateCandidateSubtitleTracks(candidate.id, subtitleTracks);
    return this.transition(jobId, 'pending', 0, {
      selectedCandidateId: candidate.id,
      errorCode: null,
      errorMessage: null
    });
  }

  replaceSource(jobId: string, sourceUrl: string): DownloadJob {
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE download_jobs
         SET source_url = ?, selected_candidate_id = NULL, status = 'pending', progress = 0,
             error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(sourceUrl, now, jobId);
    this.db.prepare('DELETE FROM media_candidates WHERE job_id = ?').run(jobId);
    const job = this.requireJob(jobId);
    this.emitRunnable();
    return job;
  }

  retry(jobId: string): DownloadJob {
    const now = nowIso();
    try {
      this.db.exec('BEGIN');
      this.db
        .prepare(
          `UPDATE download_jobs
           SET status = 'pending', progress = 0, error_code = NULL, error_message = NULL,
               selected_candidate_id = NULL, started_at = NULL, completed_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(now, jobId);
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
    return this.transition(jobId, 'canceled', job.progress);
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

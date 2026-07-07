import { v4 as uuidv4 } from 'uuid';
import type { DownloadJob, JobStatus, MediaCandidate, QueueSnapshot } from '../../shared/types.js';
import { type CandidateDraft } from '../candidate-detection/candidateDetection.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapDownloadJob, mapMediaCandidate } from '../storage/rowMappers.js';

export class JobService {
  constructor(private readonly db: Db) {}

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
    return this.requireJob(id);
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
        : status === 'pending'
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
    return this.requireJob(id);
  }

  saveCandidates(jobId: string, candidates: CandidateDraft[]): MediaCandidate[] {
    const insert = this.db.prepare(
      `INSERT INTO media_candidates (
        id, job_id, kind, url, content_type, manifest_type, resolution, bitrate,
        duration_seconds, size_bytes, confidence, headers_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        duration_seconds, size_bytes, confidence, headers_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const update = this.db.prepare(
      `UPDATE media_candidates
       SET kind = ?, content_type = ?, manifest_type = ?, resolution = ?, bitrate = ?,
           duration_seconds = ?, size_bytes = ?, confidence = ?, headers_json = ?, discovered_at = ?
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
    if (job.selectedCandidateId && ['pending', 'analyzing', 'downloading', 'processing'].includes(job.status)) {
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
    const candidate = this.db.prepare('SELECT id FROM media_candidates WHERE id = ? AND job_id = ?').get(candidateId, jobId);
    if (!candidate) {
      throw new Error('Candidate not found for job');
    }
    return this.transition(jobId, 'pending', 0, { selectedCandidateId: candidateId, errorCode: null, errorMessage: null });
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
    return this.requireJob(jobId);
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
    return this.requireJob(jobId);
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
}

function dedupeCandidates(candidates: CandidateDraft[]): CandidateDraft[] {
  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()].sort(
    (left, right) => right.confidence - left.confidence
  );
}

function isTerminalStatus(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

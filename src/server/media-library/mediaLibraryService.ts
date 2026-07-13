import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { MediaItem } from '../../shared/types.js';
import type { CategoryService } from '../categories/categoryService.js';
import { JobStateConflictError } from '../jobs/jobService.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapMediaItem } from '../storage/rowMappers.js';
import { sanitizeName, uniquePath } from '../utils/fileSafety.js';
import type { MediaFiles } from './mediaFiles.js';

export interface CreateMediaInput {
  categoryId: string;
  title: string;
  sourceUrl: string;
  finalFilePath: string;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export class MediaLibraryService {
  constructor(
    private readonly db: Db,
    private readonly categories: CategoryService,
    private readonly mediaFiles: MediaFiles
  ) {}

  list(categoryId?: string): MediaItem[] {
    const rows = categoryId
      ? this.db.prepare('SELECT * FROM media_items WHERE category_id = ? ORDER BY created_at DESC').all(categoryId)
      : this.db.prepare('SELECT * FROM media_items ORDER BY created_at DESC').all();
    return rows.map((row) => mapMediaItem(row as Record<string, unknown>));
  }

  get(id: string): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
    return row ? mapMediaItem(row as Record<string, unknown>) : null;
  }

  create(input: CreateMediaInput): MediaItem {
    const category = this.categories.get(input.categoryId);
    if (!category) {
      throw new Error('Category not found');
    }

    const created = this.insert(input, null);
    if (!created) {
      throw new Error('Media item creation failed');
    }
    return created;
  }

  completeJob(jobId: string, runId: string, input: CreateMediaInput): MediaItem {
    const category = this.categories.get(input.categoryId);
    if (!category) {
      throw new Error('Category not found');
    }
    let transactionStarted = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const existingRow = this.db.prepare('SELECT * FROM media_items WHERE job_id = ?').get(jobId);
      const existing = existingRow ? mapMediaItem(existingRow as Record<string, unknown>) : null;
      const jobRow = this.db
        .prepare('SELECT status, active_run_id, output_relative_path FROM download_jobs WHERE id = ?')
        .get(jobId) as { active_run_id?: unknown; output_relative_path?: unknown; status?: unknown } | undefined;
      if (!jobRow) {
        throw new Error('Job not found');
      }
      if (existing && String(jobRow.status) === 'completed') {
        this.db.exec('COMMIT');
        transactionStarted = false;
        return existing;
      }
      const status = String(jobRow.status);
      if (String(jobRow.active_run_id ?? '') !== runId || !['processing', 'adding_subtitles'].includes(status)) {
        throw new JobStateConflictError(`Job ${jobId} is no longer finalizable by run ${runId}`);
      }
      const relativePath = this.mediaFiles.relativeMediaPath(input.finalFilePath);
      if (String(jobRow.output_relative_path ?? '') !== relativePath) {
        throw new JobStateConflictError(`Job ${jobId} does not own output path ${relativePath}`);
      }
      const media = existing ?? this.insert(input, jobId);
      const now = nowIso();
      const result = this.db
        .prepare(
          `UPDATE download_jobs
           SET status = 'completed', progress = 1, stage_progress = 1, progress_label = NULL,
               error_code = NULL, error_message = NULL, active_run_id = NULL,
               output_relative_path = NULL, completed_at = ?, updated_at = ?
           WHERE id = ? AND active_run_id = ? AND status IN ('processing', 'adding_subtitles')`
        )
        .run(now, now, jobId, runId);
      if (result.changes === 0) {
        throw new JobStateConflictError(`Job ${jobId} changed while it was being finalized`);
      }
      this.db.exec('COMMIT');
      transactionStarted = false;
      return media;
    } catch (error) {
      if (transactionStarted) {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }

  rename(id: string, title: string): MediaItem {
    const item = this.requireItem(id);
    const oldPath = this.mediaFiles.absoluteMediaPath(item.relativePath);
    const extension = path.extname(item.filename);
    const newFilename = `${sanitizeName(title, 'video')}${extension}`;
    const newPath = uniquePath(path.dirname(oldPath), newFilename);

    fs.renameSync(oldPath, newPath);
    const updatedAt = nowIso();
    this.db
      .prepare('UPDATE media_items SET title = ?, filename = ?, relative_path = ?, updated_at = ? WHERE id = ?')
      .run(sanitizeName(title, 'video'), path.basename(newPath), this.mediaFiles.relativeMediaPath(newPath), updatedAt, id);

    return this.requireItem(id);
  }

  move(id: string, categoryId: string): MediaItem {
    const item = this.requireItem(id);
    const targetCategory = this.categories.get(categoryId);
    if (!targetCategory) {
      throw new Error('Target category not found');
    }

    const oldPath = this.mediaFiles.absoluteMediaPath(item.relativePath);
    const targetPath = uniquePath(this.categories.categoryPath(targetCategory), item.filename);
    fs.renameSync(oldPath, targetPath);

    const updatedAt = nowIso();
    this.db
      .prepare('UPDATE media_items SET category_id = ?, relative_path = ?, filename = ?, updated_at = ? WHERE id = ?')
      .run(categoryId, this.mediaFiles.relativeMediaPath(targetPath), path.basename(targetPath), updatedAt, id);

    return this.requireItem(id);
  }

  delete(id: string): void {
    const item = this.requireItem(id);
    const mediaPath = this.mediaFiles.absoluteMediaPath(item.relativePath);
    if (fs.existsSync(mediaPath)) {
      fs.unlinkSync(mediaPath);
    }
    if (item.thumbnailPath) {
      const thumbnailPath = this.mediaFiles.absoluteThumbnailPath(item.thumbnailPath);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
    }
    this.db.prepare('DELETE FROM media_items WHERE id = ?').run(id);
  }

  private insert(input: CreateMediaInput, jobId: string | null): MediaItem {
    const id = uuidv4();
    const now = nowIso();
    const relativePath = this.mediaFiles.relativeMediaPath(input.finalFilePath);
    const filename = path.basename(input.finalFilePath);
    const thumbnailRelativePath = input.thumbnailPath ? this.mediaFiles.relativeThumbnailPath(input.thumbnailPath) : null;

    this.db
      .prepare(
        `INSERT INTO media_items (
          id, category_id, title, filename, relative_path, thumbnail_path, duration_seconds,
          width, height, size_bytes, container, video_codec, audio_codec, source_url, job_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.categoryId,
        sanitizeName(input.title, 'video'),
        filename,
        relativePath,
        thumbnailRelativePath,
        input.durationSeconds,
        input.width,
        input.height,
        input.sizeBytes,
        input.container,
        input.videoCodec,
        input.audioCodec,
        input.sourceUrl,
        jobId,
        now,
        now
      );
    return this.requireItem(id);
  }

  private requireItem(id: string): MediaItem {
    const item = this.get(id);
    if (!item) {
      throw new Error('Media item not found');
    }
    return item;
  }
}

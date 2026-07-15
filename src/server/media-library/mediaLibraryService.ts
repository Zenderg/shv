import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { CategoryLabelSummary, MediaItem, MediaPage } from '../../shared/types.js';
import type { CategoryService } from '../categories/categoryService.js';
import { JobStateConflictError } from '../jobs/jobService.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapMediaItem } from '../storage/rowMappers.js';
import { sanitizeName, uniquePath } from '../utils/fileSafety.js';
import { normalizeMediaLabel, normalizeMediaLabels, parseMediaLabelsJson } from '../utils/mediaLabels.js';
import type { MediaFiles } from './mediaFiles.js';
import { MediaLabelService } from './mediaLabelService.js';

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
  labels?: string[];
}

interface MediaPageCursor {
  categoryId: string;
  createdAt: string;
  id: string;
  labelKey: string | null;
  version: 2;
}

export class InvalidMediaCursorError extends Error {
  constructor(message = 'Invalid media cursor') {
    super(message);
    this.name = 'InvalidMediaCursorError';
  }
}

export class MediaLibraryService {
  private readonly labels: MediaLabelService;

  constructor(
    private readonly db: Db,
    private readonly categories: CategoryService,
    private readonly mediaFiles: MediaFiles
  ) {
    this.labels = new MediaLabelService(db);
  }

  list(categoryId?: string): MediaItem[] {
    const rows = categoryId
      ? this.db.prepare('SELECT * FROM media_items WHERE category_id = ? ORDER BY created_at DESC, id DESC').all(categoryId)
      : this.db.prepare('SELECT * FROM media_items ORDER BY created_at DESC, id DESC').all();
    return this.mapRows(rows as Record<string, unknown>[]);
  }

  page(categoryId: string, limit: number, encodedCursor?: string, label?: string): MediaPage {
    const labelKey = label ? normalizeMediaLabel(label)?.key ?? null : null;
    const cursor = encodedCursor ? decodeMediaCursor(encodedCursor) : null;
    if (cursor && cursor.categoryId !== categoryId) {
      throw new InvalidMediaCursorError('Media cursor belongs to another category');
    }
    if (cursor && cursor.labelKey !== labelKey) {
      throw new InvalidMediaCursorError('Media cursor belongs to another label filter');
    }

    const labelClause = labelKey
      ? `AND EXISTS (
           SELECT 1 FROM media_item_labels
           WHERE media_item_labels.media_item_id = media_items.id
             AND media_item_labels.label_key = ?
         )`
      : '';
    const filterParams = labelKey ? [categoryId, labelKey] : [categoryId];

    const rows = cursor
      ? this.db
          .prepare(
            `SELECT media_items.* FROM media_items
             WHERE media_items.category_id = ?
               ${labelClause}
               AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(...filterParams, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : this.db
          .prepare(
            `SELECT media_items.* FROM media_items
             WHERE media_items.category_id = ?
             ${labelClause}
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
          )
          .all(...filterParams, limit + 1);
    const pageRows = rows.slice(0, limit);
    const items = this.mapRows(pageRows as Record<string, unknown>[]);
    const lastItem = items.at(-1);
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM media_items
       WHERE media_items.category_id = ? ${labelClause}`
    ).get(...filterParams) as
      | { count?: number | string }
      | undefined;

    return {
      items,
      nextCursor: rows.length > limit && lastItem
        ? encodeMediaCursor({ categoryId, createdAt: lastItem.createdAt, id: lastItem.id, labelKey, version: 2 })
        : null,
      total: Number(totalRow?.count ?? 0)
    };
  }

  get(id: string): MediaItem | null {
    const row = this.db.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
    return row ? this.mapRows([row as Record<string, unknown>])[0] ?? null : null;
  }

  create(input: CreateMediaInput): MediaItem {
    const category = this.categories.get(input.categoryId);
    if (!category) {
      throw new Error('Category not found');
    }

    let transactionStarted = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      const created = this.insert({
        ...input,
        labels: this.labels.canonical(input.categoryId, input.labels).map((label) => label.name)
      }, null);
      this.db.exec('COMMIT');
      transactionStarted = false;
      return created;
    } catch (error) {
      if (transactionStarted) {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
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
      const existing = existingRow ? this.mapRows([existingRow as Record<string, unknown>])[0] ?? null : null;
      const jobRow = this.db
        .prepare('SELECT status, active_run_id, output_relative_path, labels_json FROM download_jobs WHERE id = ?')
        .get(jobId) as { active_run_id?: unknown; labels_json?: unknown; output_relative_path?: unknown; status?: unknown } | undefined;
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
      const labels = this.labels.canonical(input.categoryId, parseMediaLabelsJson(jobRow.labels_json)).map((label) => label.name);
      const media = existing ?? this.insert({ ...input, labels }, jobId);
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

  setLabels(id: string, labels: string[]): MediaItem {
    const item = this.requireItem(id);
    this.labels.replace(id, item.categoryId, labels);
    return this.requireItem(id);
  }

  categoryLabelSummary(categoryId: string): CategoryLabelSummary {
    return this.labels.summary(categoryId);
  }

  renameCategoryLabel(categoryId: string, from: string, to: string): CategoryLabelSummary {
    return this.labels.renameInCategory(categoryId, from, to);
  }

  removeCategoryLabel(categoryId: string, label: string): CategoryLabelSummary {
    return this.labels.removeFromCategory(categoryId, label);
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
    this.labels.insert(id, normalizeMediaLabels(input.labels));
    return this.requireItem(id);
  }

  private mapRows(rows: Record<string, unknown>[]): MediaItem[] {
    const items = rows.map((row) => mapMediaItem(row));
    const labelsByMediaId = this.labels.namesByMediaId(items.map((item) => item.id));
    return items.map((item) => ({ ...item, labels: labelsByMediaId.get(item.id) ?? [] }));
  }

  private requireItem(id: string): MediaItem {
    const item = this.get(id);
    if (!item) {
      throw new Error('Media item not found');
    }
    return item;
  }
}

function encodeMediaCursor(cursor: MediaPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeMediaCursor(value: string): MediaPageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<MediaPageCursor> | null;
    if (
      parsed?.version !== 2
      || typeof parsed.categoryId !== 'string'
      || !parsed.categoryId
      || typeof parsed.createdAt !== 'string'
      || !parsed.createdAt
      || typeof parsed.id !== 'string'
      || !parsed.id
      || (parsed.labelKey !== null && typeof parsed.labelKey !== 'string')
    ) {
      throw new InvalidMediaCursorError();
    }
    return parsed as MediaPageCursor;
  } catch (error) {
    if (error instanceof InvalidMediaCursorError) {
      throw error;
    }
    throw new InvalidMediaCursorError();
  }
}

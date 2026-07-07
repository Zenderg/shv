import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { MediaItem } from '../../shared/types.js';
import type { CategoryService } from '../categories/categoryService.js';
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

    const id = uuidv4();
    const now = nowIso();
    const relativePath = this.mediaFiles.relativeMediaPath(input.finalFilePath);
    const filename = path.basename(input.finalFilePath);
    const thumbnailRelativePath = input.thumbnailPath ? this.mediaFiles.relativeThumbnailPath(input.thumbnailPath) : null;

    this.db
      .prepare(
        `INSERT INTO media_items (
          id, category_id, title, filename, relative_path, thumbnail_path, duration_seconds,
          width, height, size_bytes, container, video_codec, audio_codec, source_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now,
        now
      );

    const created = this.get(id);
    if (!created) {
      throw new Error('Media item creation failed');
    }
    return created;
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

  private requireItem(id: string): MediaItem {
    const item = this.get(id);
    if (!item) {
      throw new Error('Media item not found');
    }
    return item;
  }
}

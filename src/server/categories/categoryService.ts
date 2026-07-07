import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Category } from '../../shared/types.js';
import type { AppConfig } from '../config/appConfig.js';
import { nowIso, type Db } from '../storage/database.js';
import { mapCategory } from '../storage/rowMappers.js';
import { assertInsideRoot, ensureDirInside, sanitizeName } from '../utils/fileSafety.js';

export class CategoryConflictError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export class CategoryService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig
  ) {}

  list(): Category[] {
    return this.db
      .prepare('SELECT * FROM categories ORDER BY lower(name) ASC')
      .all()
      .map((row) => mapCategory(row as Record<string, unknown>));
  }

  get(id: string): Category | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    return row ? mapCategory(row as Record<string, unknown>) : null;
  }

  create(name: string): Category {
    const categoryName = sanitizeName(name, 'Category');
    const existing = this.findByName(categoryName);
    if (existing) {
      return existing;
    }

    const createdAt = nowIso();
    const id = uuidv4();
    const folderName = this.uniqueFolderName(categoryName);
    ensureDirInside(this.config.libraryRoot, path.join(this.config.libraryRoot, folderName));

    this.db
      .prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)')
      .run(id, categoryName, folderName, createdAt);

    return { id, name: categoryName, folderName, createdAt };
  }

  rename(id: string, name: string): Category | null {
    const categoryName = sanitizeName(name, 'Category');
    const existing = this.findByName(categoryName);
    if (existing && existing.id !== id) {
      throw new CategoryConflictError('Category already exists', 'category_exists');
    }

    const result = this.db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(categoryName, id);
    if (result.changes === 0) {
      return null;
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    const category = this.get(id);
    if (!category) {
      return false;
    }

    const visibleJobCount = rowCount(
      this.db.prepare("SELECT COUNT(*) AS count FROM download_jobs WHERE category_id = ? AND status != 'completed'").get(id)
    );
    if (visibleJobCount > 0) {
      throw new CategoryConflictError('Category has queue jobs', 'category_has_queue_jobs');
    }

    const mediaRows = this.db
      .prepare('SELECT relative_path, thumbnail_path FROM media_items WHERE category_id = ?')
      .all(id)
      .map((row) => mapCategoryMediaRow(row as Record<string, unknown>));
    for (const row of mediaRows) {
      deleteCategoryMediaFile(this.config.libraryRoot, row.relative_path);
      if (row.thumbnail_path) {
        deleteCategoryMediaFile(this.config.thumbnailsRoot, row.thumbnail_path);
      }
    }

    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM media_items WHERE category_id = ?').run(id);
      this.db
        .prepare(
          `DELETE FROM media_candidates
           WHERE job_id IN (SELECT id FROM download_jobs WHERE category_id = ? AND status = 'completed')`
        )
        .run(id);
      this.db.prepare("DELETE FROM download_jobs WHERE category_id = ? AND status = 'completed'").run(id);
      this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    fs.rmSync(this.categoryPath(category), { force: true, recursive: true });

    return true;
  }

  ensureDefaultCategory(): Category {
    const existing = this.db.prepare('SELECT * FROM categories ORDER BY created_at ASC LIMIT 1').get();
    if (existing) {
      return mapCategory(existing as Record<string, unknown>);
    }
    return this.create('Unsorted');
  }

  categoryPath(category: Category): string {
    return ensureDirInside(this.config.libraryRoot, path.join(this.config.libraryRoot, category.folderName));
  }

  private uniqueFolderName(name: string): string {
    const safe = sanitizeName(name, 'Category');
    let candidate = safe;
    let index = 2;
    while (
      fs.existsSync(path.join(this.config.libraryRoot, candidate)) ||
      this.db.prepare('SELECT id FROM categories WHERE folder_name = ?').get(candidate)
    ) {
      candidate = `${safe}-${index}`;
      index += 1;
    }
    return candidate;
  }

  private findByName(name: string): Category | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?) LIMIT 1').get(name);
    return row ? mapCategory(row as Record<string, unknown>) : null;
  }
}

function rowCount(row: unknown): number {
  return Number((row as { count?: number | string } | undefined)?.count ?? 0);
}

interface CategoryMediaRow {
  relative_path: string;
  thumbnail_path: string | null;
}

function mapCategoryMediaRow(row: Record<string, unknown>): CategoryMediaRow {
  return {
    relative_path: String(row.relative_path),
    thumbnail_path: row.thumbnail_path === null ? null : String(row.thumbnail_path)
  };
}

function deleteCategoryMediaFile(root: string, relativePath: string): void {
  const absolutePath = assertInsideRoot(root, path.join(root, relativePath));
  fs.rmSync(absolutePath, { force: true });
}

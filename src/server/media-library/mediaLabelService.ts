import type { CategoryLabelSummary } from '../../shared/types.js';
import { nowIso, type Db } from '../storage/database.js';
import {
  canonicalCategoryLabels,
  normalizeMediaLabel,
  normalizeMediaLabels,
  parseMediaLabelsJson,
  type NormalizedMediaLabel
} from '../utils/mediaLabels.js';

export class MediaLabelService {
  constructor(private readonly db: Db) {}

  canonical(categoryId: string, labels: readonly string[] | undefined): NormalizedMediaLabel[] {
    return canonicalCategoryLabels(this.db, categoryId, labels);
  }

  insert(mediaItemId: string, labels: readonly NormalizedMediaLabel[]): void {
    const insert = this.db.prepare(
      'INSERT INTO media_item_labels (media_item_id, name, label_key) VALUES (?, ?, ?)'
    );
    for (const label of labels) {
      insert.run(mediaItemId, label.name, label.key);
    }
  }

  namesByMediaId(mediaItemIds: readonly string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (mediaItemIds.length === 0) {
      return result;
    }
    const placeholders = mediaItemIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT media_item_id, name FROM media_item_labels
       WHERE media_item_id IN (${placeholders})
       ORDER BY label_key ASC`
    ).all(...mediaItemIds);
    for (const row of rows) {
      const typed = row as { media_item_id?: unknown; name?: unknown };
      const mediaItemId = String(typed.media_item_id ?? '');
      const labels = result.get(mediaItemId) ?? [];
      labels.push(String(typed.name ?? ''));
      result.set(mediaItemId, labels);
    }
    return result;
  }

  replace(mediaItemId: string, categoryId: string, labels: string[]): void {
    const normalized = this.canonical(categoryId, labels);
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM media_item_labels WHERE media_item_id = ?').run(mediaItemId);
      this.insert(mediaItemId, normalized);
      this.db.prepare('UPDATE media_items SET updated_at = ? WHERE id = ?').run(nowIso(), mediaItemId);
    });
  }

  summary(categoryId: string): CategoryLabelSummary {
    const totalRow = this.db.prepare('SELECT COUNT(*) AS count FROM media_items WHERE category_id = ?').get(categoryId) as
      | { count?: number | string }
      | undefined;
    const items = this.db.prepare(
      `SELECT media_item_labels.label_key, MIN(media_item_labels.name) AS name, COUNT(*) AS count
       FROM media_item_labels
       INNER JOIN media_items ON media_items.id = media_item_labels.media_item_id
       WHERE media_items.category_id = ?
       GROUP BY media_item_labels.label_key`
    ).all(categoryId).map((row) => {
      const typed = row as { count?: unknown; name?: unknown };
      return { count: Number(typed.count ?? 0), name: String(typed.name ?? '') };
    }).sort((left, right) => left.name.localeCompare(right.name));
    return { items, total: Number(totalRow?.count ?? 0) };
  }

  renameInCategory(categoryId: string, from: string, to: string): CategoryLabelSummary {
    const source = this.requireNormalized(from);
    const requestedTarget = this.requireNormalized(to);
    const existingTarget = this.summary(categoryId).items.find(
      (item) => normalizeMediaLabel(item.name)?.key === requestedTarget.key
    );
    const target = {
      ...requestedTarget,
      name: source.key === requestedTarget.key ? requestedTarget.name : existingTarget?.name ?? requestedTarget.name
    };
    this.withTransaction(() => {
      if (source.key === target.key) {
        this.db.prepare(
          `UPDATE media_item_labels SET name = ?
           WHERE label_key = ? AND media_item_id IN (
             SELECT id FROM media_items WHERE category_id = ?
           )`
        ).run(target.name, source.key, categoryId);
      } else {
        this.db.prepare(
          `INSERT OR IGNORE INTO media_item_labels (media_item_id, name, label_key)
           SELECT media_item_labels.media_item_id, ?, ?
           FROM media_item_labels
           INNER JOIN media_items ON media_items.id = media_item_labels.media_item_id
           WHERE media_items.category_id = ? AND media_item_labels.label_key = ?`
        ).run(target.name, target.key, categoryId, source.key);
        this.db.prepare(
          `DELETE FROM media_item_labels
           WHERE label_key = ? AND media_item_id IN (
             SELECT id FROM media_items WHERE category_id = ?
           )`
        ).run(source.key, categoryId);
      }
      this.updateVisibleJobs(categoryId, (labels) => labels.map((label) => (
        normalizeMediaLabel(label)?.key === source.key ? target.name : label
      )));
    });
    return this.summary(categoryId);
  }

  removeFromCategory(categoryId: string, label: string): CategoryLabelSummary {
    const normalized = this.requireNormalized(label);
    this.withTransaction(() => {
      this.db.prepare(
        `DELETE FROM media_item_labels
         WHERE label_key = ? AND media_item_id IN (
           SELECT id FROM media_items WHERE category_id = ?
         )`
      ).run(normalized.key, categoryId);
      this.updateVisibleJobs(categoryId, (labels) => labels.filter(
        (item) => normalizeMediaLabel(item)?.key !== normalized.key
      ));
    });
    return this.summary(categoryId);
  }

  private requireNormalized(value: string): NormalizedMediaLabel {
    const label = normalizeMediaLabel(value);
    if (!label) {
      throw new Error('Label cannot be empty');
    }
    return label;
  }

  private updateVisibleJobs(categoryId: string, transform: (labels: string[]) => string[]): void {
    const rows = this.db.prepare(
      `SELECT id, labels_json FROM download_jobs
       WHERE category_id = ? AND status != 'completed'`
    ).all(categoryId);
    const update = this.db.prepare('UPDATE download_jobs SET labels_json = ?, updated_at = ? WHERE id = ?');
    for (const row of rows) {
      const typed = row as { id?: unknown; labels_json?: unknown };
      const labels = normalizeMediaLabels(transform(parseMediaLabelsJson(typed.labels_json))).map((item) => item.name);
      update.run(JSON.stringify(labels), nowIso(), String(typed.id));
    }
  }

  private withTransaction(operation: () => void): void {
    let transactionStarted = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      operation();
      this.db.exec('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        this.db.exec('ROLLBACK');
      }
      throw error;
    }
  }
}

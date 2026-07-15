import type { Db } from '../storage/database.js';

export const MAX_MEDIA_LABELS = 20;
export const MAX_MEDIA_LABEL_LENGTH = 60;

export interface NormalizedMediaLabel {
  key: string;
  name: string;
}

export function normalizeMediaLabel(value: string): NormalizedMediaLabel | null {
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!name) {
    return null;
  }
  if (name.length > MAX_MEDIA_LABEL_LENGTH) {
    throw new Error(`Labels must be at most ${MAX_MEDIA_LABEL_LENGTH} characters`);
  }
  return { key: name.toLowerCase(), name };
}

export function normalizeMediaLabels(values: readonly string[] | undefined): NormalizedMediaLabel[] {
  const byKey = new Map<string, NormalizedMediaLabel>();
  for (const value of values ?? []) {
    const label = normalizeMediaLabel(value);
    if (!label) {
      throw new Error('Labels cannot be empty');
    }
    if (!byKey.has(label.key)) {
      byKey.set(label.key, label);
    }
  }
  if (byKey.size > MAX_MEDIA_LABELS) {
    throw new Error(`Videos can have at most ${MAX_MEDIA_LABELS} labels`);
  }
  return [...byKey.values()];
}

export function parseMediaLabelsJson(value: unknown): string[] {
  if (typeof value !== 'string' || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      return [];
    }
    return normalizeMediaLabels(parsed).map((label) => label.name);
  } catch {
    return [];
  }
}

export function canonicalCategoryLabels(db: Db, categoryId: string, values: readonly string[] | undefined): NormalizedMediaLabel[] {
  const labels = normalizeMediaLabels(values);
  if (labels.length === 0) {
    return labels;
  }
  const existing = new Map(
    db.prepare(
      `SELECT media_item_labels.label_key, MIN(media_item_labels.name) AS name
       FROM media_item_labels
       INNER JOIN media_items ON media_items.id = media_item_labels.media_item_id
       WHERE media_items.category_id = ?
       GROUP BY media_item_labels.label_key`
    ).all(categoryId).map((row) => {
      const typed = row as { label_key: unknown; name: unknown };
      return [String(typed.label_key), String(typed.name)] as const;
    })
  );
  return labels.map((label) => ({ ...label, name: existing.get(label.key) ?? label.name }));
}

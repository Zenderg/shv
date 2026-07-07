import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { CategoryService } from '../../src/server/categories/categoryService.js';
import { openDatabase } from '../../src/server/storage/database.js';

describe('CategoryService', () => {
  test('returns the existing category when the sanitized name already exists', () => {
    const config = tempConfig();
    const db = openDatabase(config.databasePath);
    const service = new CategoryService(db, config);

    const first = service.create('Bad:/Name');
    const second = service.create('Bad:/Name');

    expect(first.name).toBe('Bad Name');
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Bad Name');
    expect(first.folderName).toBe('Bad Name');
    expect(second.folderName).toBe('Bad Name');
    expect(fs.existsSync(path.join(config.libraryRoot, first.folderName))).toBe(true);
    expect(service.list()).toHaveLength(1);
  });

  test('renames a category without changing its folder', () => {
    const config = tempConfig();
    const db = openDatabase(config.databasePath);
    const service = new CategoryService(db, config);

    const category = service.create('Downloads');
    const renamed = service.rename(category.id, 'Favorites');

    expect(renamed).toMatchObject({
      id: category.id,
      folderName: category.folderName,
      name: 'Favorites'
    });
    expect(service.get(category.id)?.name).toBe('Favorites');
    expect(fs.existsSync(path.join(config.libraryRoot, category.folderName))).toBe(true);
  });

  test('deletes an empty category and removes its empty folder', () => {
    const config = tempConfig();
    const db = openDatabase(config.databasePath);
    const service = new CategoryService(db, config);

    const category = service.create('Temporary');
    const categoryPath = path.join(config.libraryRoot, category.folderName);

    expect(service.delete(category.id)).toBe(true);
    expect(service.get(category.id)).toBeNull();
    expect(fs.existsSync(categoryPath)).toBe(false);
  });

  test('deletes a category with its media files and thumbnails', () => {
    const config = tempConfig();
    const db = openDatabase(config.databasePath);
    const service = new CategoryService(db, config);
    const category = service.create('Watch later');
    const categoryPath = path.join(config.libraryRoot, category.folderName);
    const mediaPath = path.join(categoryPath, 'video.mp4');
    const thumbnailPath = path.join(config.thumbnailsRoot, 'thumb.jpg');
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
    fs.writeFileSync(mediaPath, 'video');
    fs.writeFileSync(thumbnailPath, 'thumbnail');

    db.prepare(`
      INSERT INTO media_items (
        id, category_id, title, filename, relative_path, thumbnail_path, duration_seconds, size_bytes,
        source_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'media-id',
      category.id,
      'Video',
      'video.mp4',
      path.join(category.folderName, 'video.mp4'),
      'thumb.jpg',
      null,
      1,
      'https://example.test/video.mp4',
      new Date().toISOString(),
      new Date().toISOString()
    );

    expect(service.delete(category.id)).toBe(true);
    expect(service.get(category.id)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM media_items WHERE category_id = ?').get(category.id)).toMatchObject({ count: 0 });
    expect(fs.existsSync(mediaPath)).toBe(false);
    expect(fs.existsSync(thumbnailPath)).toBe(false);
    expect(fs.existsSync(categoryPath)).toBe(false);
  });
});

function tempConfig(): AppConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-category-'));
  return {
    host: '127.0.0.1',
    port: 0,
    libraryRoot: path.join(root, 'library'),
    appDataRoot: path.join(root, 'app'),
    thumbnailsRoot: path.join(root, 'app', 'thumbnails'),
    browserDataRoot: path.join(root, 'app', 'browser'),
    workRoot: path.join(root, 'work'),
    databasePath: path.join(root, 'app', 'db.sqlite'),
    chromiumExecutablePath: undefined,
    ytDlpCookiesPath: path.join(root, 'app', 'youtube-cookies.txt')
  };
}

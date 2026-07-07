import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CategoryService } from '../../src/server/categories/categoryService.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { MediaFiles } from '../../src/server/media-library/mediaFiles.js';
import { MediaLibraryService } from '../../src/server/media-library/mediaLibraryService.js';
import { openDatabase } from '../../src/server/storage/database.js';
import { resetShowcaseLibrary, seedShowcaseLibrary } from '../../scripts/showcaseLibrarySeed.js';

describe('showcase library seed', () => {
  test('reset removes showcase rows and keeps ordinary media', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-showcase-seed-'));
    const config = tempConfig(root);

    const seeded = seedShowcaseLibrary(root);
    const seededFilePath = path.join(config.libraryRoot, seeded.media[0].relativePath);
    expect(fs.existsSync(seededFilePath)).toBe(true);
    expect(seeded.jobs.length).toBeGreaterThan(0);

    const db = openDatabase(config.databasePath);
    const categories = new CategoryService(db, config);
    const mediaFiles = new MediaFiles(config, categories);
    const mediaLibrary = new MediaLibraryService(db, categories, mediaFiles);
    const personalCategory = categories.create('Personal Clips');
    const personalPath = path.join(config.libraryRoot, personalCategory.folderName, 'keep.mp4');
    fs.mkdirSync(path.dirname(personalPath), { recursive: true });
    fs.writeFileSync(personalPath, 'personal video');
    const personalItem = mediaLibrary.create({
      audioCodec: null,
      categoryId: personalCategory.id,
      container: 'mp4',
      durationSeconds: 42,
      finalFilePath: personalPath,
      height: 720,
      sizeBytes: fs.statSync(personalPath).size,
      sourceUrl: 'https://example.test/keep.mp4',
      thumbnailPath: null,
      title: 'Keep me',
      videoCodec: 'h264',
      width: 1280
    });

    const reset = resetShowcaseLibrary(root);

    expect(reset.deletedMedia).toBe(seeded.media.length);
    expect(reset.deletedJobs).toBe(seeded.jobs.length);
    expect(reset.deletedCategories).toBe(seeded.categories.length);
    expect(fs.existsSync(seededFilePath)).toBe(false);
    expect(mediaLibrary.get(personalItem.id)).toMatchObject({ title: 'Keep me' });
    expect(fs.existsSync(personalPath)).toBe(true);
    expect(categories.get(personalCategory.id)).toMatchObject({ name: 'Personal Clips' });
  });
});

function tempConfig(root: string): AppConfig {
  const appDataRoot = path.join(root, 'data', 'app');
  return {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'shv.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(root, 'data', 'library'),
    port: 0,
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'data', 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'youtube-cookies.txt')
  };
}

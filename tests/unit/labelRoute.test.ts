import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { CSRF_HEADER_NAME, createRouter, errorHandler } from '../../src/server/api/routes.js';
import { CategoryService } from '../../src/server/categories/categoryService.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';
import { JobService } from '../../src/server/jobs/jobService.js';
import { MediaFiles } from '../../src/server/media-library/mediaFiles.js';
import { MediaLibraryService } from '../../src/server/media-library/mediaLibraryService.js';
import { openDatabase } from '../../src/server/storage/database.js';

const CSRF_TOKEN = 'label-route-test-token';

describe('label routes', () => {
  test('creates queued labels and manages category-derived labels without a catalog endpoint', async () => {
    const { app, categories, config, mediaLibrary } = createTestApp();
    const category = categories.create('test');
    createMedia(mediaLibrary, config, category.id, category.folderName, 'first', ['Studio A']);
    createMedia(mediaLibrary, config, category.id, category.folderName, 'second', ['Studio A', 'Series']);

    const summary = await request(app).get(`/api/categories/${category.id}/labels`).expect(200);
    expect(summary.body).toEqual({
      items: [{ count: 1, name: 'Series' }, { count: 2, name: 'Studio A' }],
      total: 2
    });

    const queued = await request(app)
      .post('/api/jobs')
      .set(CSRF_HEADER_NAME, CSRF_TOKEN)
      .send({ categoryId: category.id, labels: [' Studio A ', 'studio a'], sourceUrl: 'https://example.test/video' })
      .expect(201);
    expect((queued.body as { labels: string[] }).labels).toEqual(['Studio A']);

    const renamed = await request(app)
      .patch(`/api/categories/${category.id}/labels`)
      .set(CSRF_HEADER_NAME, CSRF_TOKEN)
      .send({ from: 'Studio A', to: 'Series' })
      .expect(200);
    expect((renamed.body as { items: unknown[] }).items).toEqual([{ count: 2, name: 'Series' }]);

    const removed = await request(app)
      .delete(`/api/categories/${category.id}/labels`)
      .set(CSRF_HEADER_NAME, CSRF_TOKEN)
      .send({ label: 'Series' })
      .expect(200);
    expect(removed.body).toEqual({ items: [], total: 2 });
  });
});

function createTestApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-label-route-'));
  const appDataRoot = path.join(root, 'app');
  const config: AppConfig = {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'db.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(root, 'library'),
    port: 0,
    sourceExtensionProfile: 'prod',
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'cookies.txt')
  };
  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
  const jobs = new JobService(db);
  const mediaFiles = new MediaFiles(config, categories);
  const mediaLibrary = new MediaLibraryService(db, categories, mediaFiles);
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    categories,
    config,
    csrfToken: CSRF_TOKEN,
    extensionDebug: new ExtensionDebugService(),
    jobs,
    liveBrowser: {} as never,
    mediaFiles,
    mediaLibrary,
    queueRunner: {} as never
  }));
  app.use(errorHandler);
  return { app, categories, config, mediaLibrary };
}

function createMedia(
  mediaLibrary: MediaLibraryService,
  config: AppConfig,
  categoryId: string,
  folderName: string,
  title: string,
  labels: string[]
) {
  const finalFilePath = path.join(config.libraryRoot, folderName, `${title}.mp4`);
  fs.mkdirSync(path.dirname(finalFilePath), { recursive: true });
  fs.writeFileSync(finalFilePath, title);
  mediaLibrary.create({
    audioCodec: 'aac',
    categoryId,
    container: 'mp4',
    durationSeconds: 1,
    finalFilePath,
    height: 720,
    labels,
    sizeBytes: title.length,
    sourceUrl: `https://example.test/${title}`,
    thumbnailPath: null,
    title,
    videoCodec: 'h264',
    width: 1280
  });
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';
import type { MediaItem } from '../../src/shared/types.js';

describe('media route', () => {
  test('rejects byte ranges whose end is before start', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-media-route-'));
    const mediaPath = path.join(root, 'library', 'video.mp4');
    fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
    fs.writeFileSync(mediaPath, Buffer.alloc(100));
    const app = express();
    app.use(createRouter({
      categories: {} as never,
      config: tempConfig(root),
      extensionDebug: new ExtensionDebugService(),
      jobs: {} as never,
      liveBrowser: {} as never,
      mediaFiles: {
        absoluteMediaPath: () => mediaPath
      } as never,
      mediaLibrary: {
        get: () => mediaItem()
      } as never,
      queueRunner: {} as never
    }));
    app.use(errorHandler);

    const response = await request(app)
      .get('/media/media-id')
      .set('Range', 'bytes=80-40')
      .expect(416);

    expect(response.headers['content-range']).toBeUndefined();
    expect(response.headers['content-length']).not.toBe('-39');
  });
});

function tempConfig(root: string): AppConfig {
  const appDataRoot = path.join(root, 'app');
  return {
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
}

function mediaItem(): MediaItem {
  return {
    audioCodec: null,
    categoryId: 'category-id',
    container: null,
    createdAt: '2026-07-08T00:00:00.000Z',
    durationSeconds: null,
    filename: 'video.mp4',
    height: null,
    id: 'media-id',
    relativePath: 'video.mp4',
    sizeBytes: 100,
    sourceUrl: 'https://example.test/video.mp4',
    thumbnailPath: null,
    title: 'Video',
    updatedAt: '2026-07-08T00:00:00.000Z',
    videoCodec: null,
    width: null
  };
}

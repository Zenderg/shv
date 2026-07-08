import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';

describe('extension debug route', () => {
  test('records and lists extension debug events in the dev profile', async () => {
    const { app } = createApp('dev');

    await request(app)
      .post('/api/debug/extension/events')
      .send({
        eventType: 'metadata-probe',
        jobId: 'job-id',
        tabId: 42,
        candidateUrl: 'https://vkv531.okcdn.ru/?sig=test',
        frameUrl: 'https://vk.example.test/embed',
        status: 'unavailable',
        reason: 'video-error',
        details: {
          contentType: 'video/mp4',
          mediaErrorCode: 4
        }
      })
      .expect(204);

    const response = await request(app).get('/api/debug/extension/events').expect(200);

    expect(response.body).toEqual({
      events: [
        expect.objectContaining({
          candidateUrl: 'https://vkv531.okcdn.ru/?sig=test',
          eventType: 'metadata-probe',
          frameUrl: 'https://vk.example.test/embed',
          jobId: 'job-id',
          reason: 'video-error',
          status: 'unavailable',
          tabId: 42
        })
      ]
    });
  });

  test('does not expose extension debug routes in the production profile', async () => {
    const { app } = createApp('prod');

    await request(app).get('/api/debug/extension/events').expect(404);
    await request(app)
      .post('/api/debug/extension/events')
      .send({ eventType: 'metadata-probe', status: 'unavailable' })
      .expect(404);
  });
});

function createApp(sourceExtensionProfile: 'dev' | 'prod') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-extension-debug-'));
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    categories: {} as never,
    config: tempConfig(root, sourceExtensionProfile),
    extensionDebug: new ExtensionDebugService(),
    jobs: {} as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: {} as never
  }));
  app.use(errorHandler);
  return { app };
}

function tempConfig(root: string, sourceExtensionProfile: 'dev' | 'prod'): AppConfig {
  const appDataRoot = path.join(root, 'app');
  return {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'db.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(root, 'library'),
    port: 0,
    sourceExtensionProfile,
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'cookies.txt')
  };
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';
import { JobService } from '../../src/server/jobs/jobService.js';
import { openDatabase } from '../../src/server/storage/database.js';
import type { MediaCandidate, QueueSnapshot } from '../../src/shared/types.js';

describe('candidate API responses', () => {
  test('strip request headers without changing internal download context', async () => {
    const { app, jobId, jobs } = createAppWithCandidate();

    const queueResponse = await request(app).get('/api/queue').expect(200);
    const candidatesResponse = await request(app).get(`/api/jobs/${jobId}/candidates`).expect(200);
    const queue = queueResponse.body as QueueSnapshot;
    const candidates = candidatesResponse.body as MediaCandidate[];

    expect(queue.candidatesByJobId[jobId][0]).toMatchObject({
      headers: {},
      subtitleTracks: [expect.not.objectContaining({ headers: expect.anything() })]
    });
    expect(candidates[0]).toMatchObject({
      headers: {},
      subtitleTracks: [expect.not.objectContaining({ headers: expect.anything() })]
    });
    expect(jobs.listCandidates(jobId)[0]).toMatchObject({
      headers: {
        authorization: 'Bearer media-token',
        cookie: 'session=secret',
        'x-media-token': 'custom-secret'
      },
      subtitleTracks: [{ headers: { authorization: 'Bearer subtitle-token' } }]
    });
  });
});

function createAppWithCandidate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-candidate-response-'));
  const db = openDatabase(path.join(root, 'db.sqlite'));
  const jobs = new JobService(db);
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    categories: {} as never,
    config: tempConfig(root),
    csrfToken: 'test-csrf-token',
    extensionDebug: new ExtensionDebugService(),
    jobs,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: {} as never
  }));
  app.use(errorHandler);

  const categoryId = '7b2d8d17-a7dd-4f1d-b143-82ed9b70dbd6';
  db.prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)').run(
    categoryId,
    'test',
    'test',
    new Date().toISOString()
  );
  const job = jobs.create('https://example.test/page', categoryId);
  jobs.saveCandidates(job.id, [{
    bitrate: null,
    confidence: 0.92,
    contentType: 'video/mp4',
    durationSeconds: null,
    headers: {
      authorization: 'Bearer media-token',
      cookie: 'session=secret',
      'x-media-token': 'custom-secret'
    },
    kind: 'browser-request',
    manifestType: null,
    resolution: null,
    sizeBytes: null,
    subtitleTracks: [{
      contentType: 'text/vtt',
      format: 'webvtt',
      headers: { authorization: 'Bearer subtitle-token' },
      isDefault: false,
      isSelected: null,
      label: 'English',
      language: 'en',
      source: 'network',
      url: 'https://media.example.test/subtitles/en.vtt'
    }],
    url: 'https://media.example.test/video.mp4'
  }]);

  return { app, jobId: job.id, jobs };
}

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

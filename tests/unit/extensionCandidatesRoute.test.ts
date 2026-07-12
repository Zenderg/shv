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
import type { QueueRunner } from '../../src/server/jobs/queueRunner.js';
import { openDatabase } from '../../src/server/storage/database.js';
import type { DownloadJob, SubtitleTrack } from '../../src/shared/types.js';

describe('extension candidate route', () => {
  test('delegates retry and source replacement to the queue runner', async () => {
    const calls: Array<{ id: string; sourceUrl?: string; type: 'replace-source' | 'retry' }> = [];
    const queueRunner = {
      retry: (id: string) => {
        calls.push({ id, type: 'retry' });
        return { id, status: 'pending' } as DownloadJob;
      },
      replaceSource: (id: string, sourceUrl: string) => {
        calls.push({ id, sourceUrl, type: 'replace-source' });
        return { id, sourceUrl, status: 'pending' } as DownloadJob;
      }
    } satisfies Pick<QueueRunner, 'replaceSource' | 'retry'>;
    const { app, job } = createAppWithJob(queueRunner);

    await request(app)
      .post(`/api/jobs/${job.id}/retry`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .expect(200);
    await request(app)
      .post(`/api/jobs/${job.id}/replace-source`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ sourceUrl: 'https://example.test/replacement' })
      .expect(200);

    expect(calls).toEqual([
      { id: job.id, type: 'retry' },
      { id: job.id, sourceUrl: 'https://example.test/replacement', type: 'replace-source' }
    ]);
  });

  test('rejects non-http URLs before they can enter job or candidate flows', async () => {
    const { app, job } = createAppWithJob();
    const fileUrl = 'file:///etc/passwd';

    await request(app)
      .post('/api/jobs')
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ categoryId: job.categoryId, sourceUrl: fileUrl })
      .expect(400);
    await request(app)
      .post(`/api/jobs/${job.id}/replace-source`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ sourceUrl: fileUrl })
      .expect(400);
    await request(app)
      .post(`/api/jobs/${job.id}/select-subtitle-track`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ subtitleTrackUrl: fileUrl })
      .expect(400);
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate(fileUrl)] })
      .expect(400);
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate('https://media.example.test/video.m3u8', [subtitleTrack(fileUrl, 'Local file', 'en')])] })
      .expect(400);
  });

  test('treats extension candidates as the current source-session snapshot', async () => {
    const { app, job, jobs } = createAppWithJob();

    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate('https://media.example.test/old.m3u8')] })
      .expect(200);
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate('https://media.example.test/new.m3u8')] })
      .expect(200);

    expect(jobs.listCandidates(job.id).map((item) => item.url)).toEqual(['https://media.example.test/new.m3u8']);
  });

  test('does not replace the selected candidate while the selected job is runnable', async () => {
    const { app, job, jobs } = createAppWithJob();
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate('https://media.example.test/selected.m3u8')] })
      .expect(200);
    const selected = jobs.listCandidates(job.id)[0];
    jobs.selectCandidate(job.id, selected.id);

    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidates: [candidate('https://media.example.test/late-network-candidate.m3u8')] })
      .expect(200);

    expect(jobs.requireJob(job.id).selectedCandidateId).toBe(selected.id);
    expect(jobs.listCandidates(job.id).map((item) => item.id)).toContain(selected.id);
    expect(jobs.listCandidates(job.id).map((item) => item.url)).not.toContain('https://media.example.test/late-network-candidate.m3u8');
  });

  test('pauses a selected source with subtitles until a subtitle track is chosen', async () => {
    const { app, job, jobs } = createAppWithJob();
    const russianUrl = 'https://media.example.test/subtitles/ru.ass';
    const englishUrl = 'https://media.example.test/subtitles/en.ass';
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({
        candidates: [
          candidate('https://media.example.test/video/index.m3u8', [
            subtitleTrack(russianUrl, 'Russian', 'ru'),
            subtitleTrack(englishUrl, 'English', 'en')
          ])
        ]
      })
      .expect(200);
    const selected = jobs.listCandidates(job.id)[0];

    const selection = await request(app)
      .post(`/api/jobs/${job.id}/select-candidate`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidateId: selected.id })
      .expect(200);

    expect(selection.body).toMatchObject({
      selectedCandidateId: selected.id,
      status: 'needs_subtitle_selection'
    });
    expect(jobs.nextRunnableJob()).toBeNull();

    const continuation = await request(app)
      .post(`/api/jobs/${job.id}/select-subtitle-track`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ subtitleTrackUrl: englishUrl })
      .expect(200);

    expect(continuation.body).toMatchObject({
      selectedCandidateId: selected.id,
      status: 'pending'
    });
    expect(jobs.nextRunnableJob()?.id).toBe(job.id);
    expect(jobs.listCandidates(job.id)[0].subtitleTracks).toEqual([
      expect.objectContaining({ isSelected: false, label: 'Russian', url: russianUrl }),
      expect.objectContaining({ isSelected: true, label: 'English', url: englishUrl })
    ]);
  });

  test('allows continuing without subtitles for a source with detected subtitle tracks', async () => {
    const { app, job, jobs } = createAppWithJob();
    const russianUrl = 'https://media.example.test/subtitles/ru.ass';
    await request(app)
      .post(`/api/jobs/${job.id}/extension-candidates`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({
        candidates: [candidate('https://media.example.test/video/index.m3u8', [subtitleTrack(russianUrl, 'Russian', 'ru')])]
      })
      .expect(200);
    const selected = jobs.listCandidates(job.id)[0];
    await request(app)
      .post(`/api/jobs/${job.id}/select-candidate`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ candidateId: selected.id })
      .expect(200);

    await request(app)
      .post(`/api/jobs/${job.id}/select-subtitle-track`)
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({ subtitleTrackUrl: null })
      .expect(200);

    expect(jobs.requireJob(job.id).status).toBe('pending');
    expect(jobs.listCandidates(job.id)[0].subtitleTracks).toEqual([
      expect.objectContaining({ isSelected: false, label: 'Russian', url: russianUrl })
    ]);
  });
});

function createAppWithJob(queueRunner: Pick<QueueRunner, 'replaceSource' | 'retry'> = {} as never) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-extension-candidates-'));
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
    queueRunner: queueRunner as QueueRunner
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
  return { app, job, jobs };
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

function candidate(url: string, subtitleTracks: SubtitleTrack[] = []) {
  return {
    bitrate: null,
    confidence: 0.92,
    contentType: 'application/vnd.apple.mpegurl',
    durationSeconds: null,
    headers: {},
    kind: 'hls',
    manifestType: 'hls',
    resolution: null,
    sizeBytes: null,
    subtitleTracks,
    url
  };
}

function subtitleTrack(url: string, label: string, language: string): SubtitleTrack {
  return {
    contentType: 'text/x-ssa',
    format: 'ass',
    isDefault: false,
    isSelected: null,
    label,
    language,
    source: 'network',
    url
  };
}

import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { DownloadJob } from '../../src/shared/types.js';

describe('job status route', () => {
  test('returns persisted completed jobs that are hidden from the queue snapshot', async () => {
    const job = completedJob();
    const app = createApp((id) => id === job.id ? job : null);

    const response = await request(app).get(`/api/jobs/${job.id}`).expect(200);

    expect(response.body).toMatchObject({ id: job.id, status: 'completed' });
  });

  test('returns not found after a job has been deleted', async () => {
    const app = createApp(() => null);

    const response = await request(app).get('/api/jobs/2b6009a4-5f27-4b61-bdf7-63d7e7c949d1').expect(404);

    expect(response.body).toEqual({ error: 'job_not_found' });
  });
});

function createApp(getJob: (id: string) => DownloadJob | null) {
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    categories: {} as never,
    config: {
      sourceExtensionProfile: 'prod'
    } as never,
    csrfToken: 'test-csrf-token',
    extensionDebug: {} as never,
    jobs: { get: getJob } as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: {} as never
  }));
  app.use(errorHandler);
  return app;
}

function completedJob(): DownloadJob {
  return {
    categoryId: 'category-id',
    completedAt: '2026-07-13T12:00:00.000Z',
    createdAt: '2026-07-13T11:00:00.000Z',
    errorCode: null,
    errorMessage: null,
    id: '3df39a19-7ca7-4900-af01-665c9d614460',
    progressLabel: null,
    selectedCandidateId: null,
    sourceUrl: 'https://example.test/video.mp4',
    stageProgress: 1,
    startedAt: '2026-07-13T11:00:01.000Z',
    status: 'completed',
    titleHint: 'Video',
    updatedAt: '2026-07-13T12:00:00.000Z'
  };
}

import express from 'express';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';

describe('CSRF protection', () => {
  test('exposes the server CSRF token through runtime config', async () => {
    const { app } = createAppWithCsrfToken('test-csrf-token');

    const response = await request(app)
      .get('/api/runtime-config')
      .expect(200);

    expect((response.body as { csrfToken?: string }).csrfToken).toBe('test-csrf-token');
  });

  test('rejects state-changing requests without the CSRF token before route handlers run', async () => {
    const { app, queueRunner } = createAppWithCsrfToken('test-csrf-token');

    await request(app)
      .post('/api/jobs/job-id/cancel')
      .set('Origin', 'https://attacker.example')
      .type('form')
      .send('cross-site=1')
      .expect(403);

    expect(queueRunner.cancel).not.toHaveBeenCalled();
  });

  test('accepts state-changing requests with the CSRF token', async () => {
    const { app, queueRunner } = createAppWithCsrfToken('test-csrf-token');

    await request(app)
      .post('/api/jobs/job-id/cancel')
      .set('X-SHV-CSRF', 'test-csrf-token')
      .expect(200);

    expect(queueRunner.cancel).toHaveBeenCalledWith('job-id');
  });
});

function createAppWithCsrfToken(csrfToken: string) {
  const app = express();
  const queueRunner = { cancel: vi.fn((id: string) => ({ id, status: 'canceled' })) };
  app.use(express.json());
  app.use(createRouter({
    categories: {} as never,
    config: {
      appDataRoot: '',
      browserDataRoot: '',
      chromiumExecutablePath: undefined,
      databasePath: '',
      host: '127.0.0.1',
      libraryRoot: '',
      port: 0,
      sourceExtensionProfile: 'prod',
      thumbnailsRoot: '',
      workRoot: '',
      ytDlpCookiesPath: ''
    },
    csrfToken,
    extensionDebug: {} as never,
    jobs: {} as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: queueRunner as never
  } as never));
  app.use(errorHandler);
  return { app, queueRunner };
}

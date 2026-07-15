import express from 'express';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { RouteServices } from '../../src/server/api/routes.js';
import { InvalidMediaCursorError } from '../../src/server/media-library/mediaLibraryService.js';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

describe('media pagination route', () => {
  test('passes bounded pagination input to the media library', async () => {
    const page = vi.fn(() => ({ items: [], nextCursor: null, total: 0 }));
    const app = createTestApp(page);

    const response = await request(app)
      .get('/api/media')
      .query({ categoryId: CATEGORY_ID, cursor: 'opaque-cursor', label: 'Studio A', limit: 30 })
      .expect(200);

    expect(response.body).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(page).toHaveBeenCalledWith(CATEGORY_ID, 30, 'opaque-cursor', 'Studio A');
  });

  test('rejects invalid limits and cursors as client errors', async () => {
    const page = vi.fn(() => {
      throw new InvalidMediaCursorError();
    });
    const app = createTestApp(page);

    await request(app).get('/api/media').query({ categoryId: CATEGORY_ID, limit: 101 }).expect(400);
    const invalidCursor = await request(app)
      .get('/api/media')
      .query({ categoryId: CATEGORY_ID, cursor: 'invalid', limit: 30 })
      .expect(400);

    expect(invalidCursor.body).toEqual({ error: 'invalid_media_cursor', message: 'Invalid media cursor' });
  });
});

function createTestApp(page: (...args: unknown[]) => unknown) {
  const app = express();
  app.use(createRouter({
    categories: {} as never,
    config: { sourceExtensionProfile: 'prod' } as never,
    csrfToken: 'test-token',
    extensionDebug: {} as never,
    jobs: {} as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: { page } as never,
    queueRunner: {} as never
  } satisfies RouteServices));
  app.use(errorHandler);
  return app;
}

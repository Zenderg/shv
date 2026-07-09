import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { errorHandler } from '../../src/server/api/routes.js';

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns generic 500 errors while logging the original error', async () => {
    const sensitiveError = new Error('SQLITE_BUSY: unable to open /data/app/private.sqlite');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/explode', (_request, _response, next) => {
      next(sensitiveError);
    });
    app.use(errorHandler);

    const response = await request(app).get('/explode').expect(500);

    expect(response.body).toEqual({
      error: 'server_error',
      message: 'Internal server error'
    });
    expect(JSON.stringify(response.body)).not.toContain('/data/app/private.sqlite');
    expect(consoleError).toHaveBeenCalledWith('[shv] api-error', sensitiveError);
  });
});

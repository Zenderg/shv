import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createApp } from '../../src/server/index.js';

describe('security headers', () => {
  test('applies baseline browser security headers to app responses', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-security-headers-'));
    const previousEnv = {
      APP_DATA_ROOT: process.env.APP_DATA_ROOT,
      LIBRARY_ROOT: process.env.LIBRARY_ROOT,
      WORK_ROOT: process.env.WORK_ROOT,
      PORT: process.env.PORT,
      HOST: process.env.HOST
    };
    process.env.APP_DATA_ROOT = path.join(root, 'app');
    process.env.LIBRARY_ROOT = path.join(root, 'library');
    process.env.WORK_ROOT = path.join(root, 'work');
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';

    const { app, db } = createApp();
    try {
      const response = await request(app).get('/api/health').expect(200);

      expect(response.headers['content-security-policy']).toBe(
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'"
      );
      expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-powered-by']).toBeUndefined();
    } finally {
      db.close();
      restoreEnv(previousEnv);
    }
  });
});

function restoreEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

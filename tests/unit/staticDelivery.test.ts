import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import {
  apiCachePolicy,
  apiNotFound,
  createWebRouter
} from '../../src/server/web/staticDelivery.js';

describe('static delivery', () => {
  test('compresses and immutably caches hashed assets', async () => {
    const root = createWebRoot();
    const app = express();
    app.use(compression({ threshold: 1_024 }));
    app.use(createWebRouter(root));

    const response = await request(app)
      .get('/assets/app-ABCDEFGH.js')
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toContain('Accept-Encoding');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('never serves the SPA shell for missing assets', async () => {
    const root = createWebRoot();
    const app = express();
    app.use(createWebRouter(root));

    const missingChunk = await request(app).get('/assets/old-hash.js').expect(404);
    const missingScript = await request(app).get('/missing.js').expect(404);
    const navigation = await request(app).get('/library').set('Accept', 'text/html').expect(200);

    expect(missingChunk.text).toBe('Not Found');
    expect(missingChunk.headers['cache-control']).toBe('no-store');
    expect(missingScript.text).not.toContain('<!doctype');
    expect(navigation.text).toContain('<!doctype html>');
    expect(navigation.headers['cache-control']).toBe('no-cache');
  });

  test('marks API responses and API 404s as no-store', async () => {
    const app = express();
    app.use('/api', apiCachePolicy);
    app.get('/api/health', (_request, response) => response.json({ ok: true }));
    app.use('/api', apiNotFound);

    expect((await request(app).get('/api/health').expect(200)).headers['cache-control']).toBe('no-store');
    const missing = await request(app).get('/api/missing').expect(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    expect(missing.body).toEqual({ error: 'api_not_found' });
  });
});

function createWebRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-static-delivery-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(root, 'assets', 'app-ABCDEFGH.js'), 'const value = "compression";\n'.repeat(200));
  return root;
}

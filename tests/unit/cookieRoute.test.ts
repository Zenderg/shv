import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createRouter, errorHandler } from '../../src/server/api/routes.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';

describe('cookie route', () => {
  test('stores uploaded browser cookies as a Netscape cookies file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-cookies-'));
    const cookiesPath = path.join(root, 'youtube-cookies.txt');
    const app = createCookieRouteApp(tempConfig(root, cookiesPath));

    await request(app)
      .post('/api/jobs/job-id/cookies')
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({
        cookies: [
          {
            domain: '.youtube.com',
            expirationDate: 1893456000,
            httpOnly: true,
            name: 'SID',
            path: '/',
            secure: true,
            value: 'abc'
          }
        ]
      })
      .expect(204);

    expect(fs.readFileSync(cookiesPath, 'utf8')).toContain(
      '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tabc'
    );
  });

  test('merges uploaded cookies with existing cookie file entries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-cookies-'));
    const cookiesPath = path.join(root, 'cookies.txt');
    fs.writeFileSync(cookiesPath, [
      '# Netscape HTTP Cookie File',
      '.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\told',
      ''
    ].join('\n'));
    const app = createCookieRouteApp(tempConfig(root, cookiesPath));

    await request(app)
      .post('/api/jobs/job-id/cookies')
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({
        cookies: [
          {
            domain: '.example.test',
            expirationDate: 1893456000,
            httpOnly: false,
            name: 'session',
            path: '/',
            secure: true,
            value: 'new'
          }
        ]
      })
      .expect(204);

    const file = fs.readFileSync(cookiesPath, 'utf8');
    expect(file).toContain('.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\told');
    expect(file).toContain('.example.test\tTRUE\t/\tTRUE\t1893456000\tsession\tnew');
  });

  test('rejects cookies for unknown jobs without creating a cookie file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-cookies-'));
    const cookiesPath = path.join(root, 'cookies.txt');
    const app = createCookieRouteApp(tempConfig(root, cookiesPath), { get: () => null });

    const response = await request(app)
      .post('/api/jobs/missing-job/cookies')
      .set('X-SHV-CSRF', 'test-csrf-token')
      .send({
        cookies: [
          {
            domain: '.youtube.com',
            expirationDate: 1893456000,
            httpOnly: true,
            name: 'SID',
            path: '/',
            secure: true,
            value: 'abc'
          }
        ]
      })
      .expect(404);

    expect(response.body).toEqual({ error: 'job_not_found' });
    expect(fs.existsSync(cookiesPath)).toBe(false);
  });
});

function createCookieRouteApp(config: AppConfig, jobs: { get: (id: string) => unknown } = { get: () => ({ id: 'job-id' }) }) {
  const app = express();
  app.use(express.json());
  app.use(createRouter({
    categories: {} as never,
    config,
    csrfToken: 'test-csrf-token',
    extensionDebug: new ExtensionDebugService(),
    jobs: jobs as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: {} as never
  }));
  app.use(errorHandler);
  return app;
}

function tempConfig(root: string, cookiesPath: string): AppConfig {
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
    ytDlpCookiesPath: cookiesPath
  };
}

import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import {
  DEV_SOURCE_EXTENSION_ID,
  PROD_SOURCE_EXTENSION_ID,
  createRouter,
  errorHandler,
  sourceExtensionProfile,
  extensionZipEntries
} from '../../src/server/api/routes.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { ExtensionDebugService } from '../../src/server/extension-debug/extensionDebugService.js';
import { buildZipArchive } from '../../src/server/utils/zipArchive.js';

describe('extension package entries', () => {
  test('packages the helper extension for the app origin that downloaded it', () => {
    const extensionRoot = path.resolve(process.cwd(), 'extension/chrome-source-helper');
    const entries = extensionZipEntries(
      extensionRoot,
      sourceExtensionProfile('prod'),
      'https://prod.example.test'
    );
    const archive = buildZipArchive(entries);
    const contentScriptEntry = entries.find((entry) => entry.name === 'shv-source-helper/content-script.js');
    const manifestEntry = entries.find((entry) => entry.name === 'shv-source-helper/manifest.json');
    const manifest = JSON.parse(manifestEntry?.data.toString('utf8') ?? '{}') as { key?: string };

    expect(archive.includes(Buffer.from('"name": "shv Source Helper"'))).toBe(true);
    expect(archive.includes(Buffer.from('"https://prod.example.test/*"'))).toBe(true);
    expect(archive.includes(Buffer.from("export const APP_ORIGIN = 'https://prod.example.test';"))).toBe(true);
    expect(manifest.key).toBe(sourceExtensionProfile('prod').key);
    expect(contentScriptEntry?.data.toString('utf8')).toContain('https://prod.example.test');
    expect(contentScriptEntry?.data.toString('utf8')).not.toContain('http://127.0.0.1:8080');
  });

  test('packages a separate dev helper extension from the same source files', () => {
    const extensionRoot = path.resolve(process.cwd(), 'extension/chrome-source-helper');
    const entries = extensionZipEntries(
      extensionRoot,
      sourceExtensionProfile('dev'),
      'http://127.0.0.1:8080'
    );
    const manifestEntry = entries.find((entry) => entry.name === 'shv-source-helper-dev/manifest.json');

    expect(manifestEntry).toBeDefined();
    expect(entries.some((entry) => entry.name === 'shv-source-helper-dev/service-worker.js')).toBe(true);
    expect(entries.some((entry) => entry.name === 'shv-source-helper-dev/content-script.js')).toBe(true);

    const manifest = JSON.parse(manifestEntry?.data.toString('utf8') ?? '{}') as {
      content_scripts?: Array<{ matches?: string[] }>;
      key?: string;
      name?: string;
      externally_connectable?: { matches?: string[] };
    };

    expect(sourceExtensionProfile('prod').id).toBe(PROD_SOURCE_EXTENSION_ID);
    expect(sourceExtensionProfile('dev').id).toBe(DEV_SOURCE_EXTENSION_ID);
    expect(sourceExtensionProfile('dev').id).not.toBe(sourceExtensionProfile('prod').id);
    expect(manifest.name).toBe('shv Source Helper Dev');
    expect(manifest.key).toBe(sourceExtensionProfile('dev').key);
    expect(manifest.externally_connectable?.matches).toContain('http://127.0.0.1:8080/*');
    expect(manifest.content_scripts?.[0]?.matches).toContain('http://127.0.0.1:8080/*');
  });

  test('does not trust forwarded headers when deriving the package app origin', async () => {
    const app = createApp(tempConfig());

    const response = await request(app)
      .get('/extension/shv-source-helper.zip')
      .set('Host', '192.168.1.42:8080')
      .set('X-Forwarded-Host', 'attacker.example.test')
      .set('X-Forwarded-Proto', 'https')
      .set('Referer', 'https://attacker.example.test/install')
      .parse(bufferResponse)
      .expect(200);
    const archive = response.body as Buffer;

    expect(archive.includes(Buffer.from('http://192.168.1.42:8080/*'))).toBe(true);
    expect(archive.includes(Buffer.from('https://attacker.example.test/*'))).toBe(false);
    expect(archive.includes(Buffer.from("export const APP_ORIGIN = 'https://attacker.example.test';"))).toBe(false);
  });

  test('rejects public host-derived extension origins without configured public origin', async () => {
    const app = createApp(tempConfig());

    const response = await request(app)
      .get('/extension/shv-source-helper.zip')
      .set('Host', 'attacker.example.test')
      .expect(400);

    expect(response.body).toEqual({ error: 'public_origin_required' });
  });

  test('allows private LAN host-derived extension origins', async () => {
    const app = createApp(tempConfig());

    const response = await request(app)
      .get('/extension/shv-source-helper.zip')
      .set('Host', '192.168.1.42:8080')
      .expect(200);

    expect(response.headers['content-disposition']).toBe('attachment; filename="shv-source-helper.zip"');
  });

  test('allows local LAN hostname-derived extension origins', async () => {
    const app = createApp(tempConfig());

    const response = await request(app)
      .get('/extension/shv-source-helper.zip')
      .set('Host', 'shv.local:8080')
      .expect(200);

    expect(response.headers['content-disposition']).toBe('attachment; filename="shv-source-helper.zip"');
  });

  test('allows configured public origin when request host is public', async () => {
    const app = createApp(tempConfig({ publicOrigin: 'https://videos.example.test' }));

    const response = await request(app)
      .get('/extension/shv-source-helper.zip')
      .set('Host', 'attacker.example.test')
      .expect(200);

    expect(response.headers['content-disposition']).toBe('attachment; filename="shv-source-helper.zip"');
  });
});

function createApp(config: AppConfig) {
  const app = express();
  app.use(createRouter({
    categories: {} as never,
    config,
    csrfToken: 'test-csrf-token',
    extensionDebug: new ExtensionDebugService(),
    jobs: {} as never,
    liveBrowser: {} as never,
    mediaFiles: {} as never,
    mediaLibrary: {} as never,
    queueRunner: {} as never
  }));
  app.use(errorHandler);
  return app;
}

function tempConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const appDataRoot = path.join(process.cwd(), 'data/app');
  return {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'db.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(process.cwd(), 'data/library'),
    port: 8080,
    sourceExtensionProfile: 'prod',
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(process.cwd(), 'data/work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'cookies.txt'),
    ...overrides
  };
}

function bufferResponse(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

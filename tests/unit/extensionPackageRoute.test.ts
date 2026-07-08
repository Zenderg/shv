import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEV_SOURCE_EXTENSION_ID,
  PROD_SOURCE_EXTENSION_ID,
  sourceExtensionProfile,
  extensionZipEntries
} from '../../src/server/api/routes.js';
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

    expect(archive.includes(Buffer.from('"name": "shv Source Helper"'))).toBe(true);
    expect(archive.includes(Buffer.from('"https://prod.example.test/*"'))).toBe(true);
    expect(archive.includes(Buffer.from("export const APP_ORIGIN = 'https://prod.example.test';"))).toBe(true);
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
});

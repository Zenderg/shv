import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { extensionZipEntries } from '../../src/server/api/routes.js';
import { buildZipArchive } from '../../src/server/utils/zipArchive.js';

describe('extension package entries', () => {
  test('packages the helper extension for the app origin that downloaded it', () => {
    const extensionRoot = path.resolve(process.cwd(), 'extension/chrome-source-helper');
    const entries = extensionZipEntries(extensionRoot, 'shv-source-helper', 'https://prod.example.test');
    const archive = buildZipArchive(entries);

    expect(archive.includes(Buffer.from('"https://prod.example.test/*"'))).toBe(true);
    expect(archive.includes(Buffer.from("export const APP_ORIGIN = 'https://prod.example.test';"))).toBe(true);
  });
});

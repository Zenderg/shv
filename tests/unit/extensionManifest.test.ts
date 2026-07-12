import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCE_EXTENSION_REQUIRED_VERSION } from '../../src/web/src/lib/extensionBridge.js';

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'extension/chrome-source-helper/manifest.json'), 'utf8')
) as {
  content_scripts?: Array<{ all_frames?: boolean; js?: string[]; matches?: string[] }>;
  host_permissions?: string[];
  key?: string;
  permissions?: string[];
  side_panel?: unknown;
  version?: string;
};
const sharedSource = readFileSync(resolve(process.cwd(), 'extension/chrome-source-helper/shared.js'), 'utf8');
const sharedVersion = sharedSource.match(/EXTENSION_VERSION = '([^']+)'/)?.[1];

describe('chrome source helper manifest', () => {
  it('does not require native browser side-panel APIs', () => {
    expect(manifest.side_panel).toBeUndefined();
    expect(manifest.permissions ?? []).not.toContain('sidePanel');
  });

  it('loads only the app bridge through static content scripts', () => {
    expect(manifest.content_scripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          all_frames: true,
          js: expect.arrayContaining(['content-script.js']),
          matches: expect.arrayContaining(['http://127.0.0.1:8080/*', 'http://localhost:8080/*'])
        })
      ])
    );
    expect(manifest.content_scripts?.flatMap((script) => script.matches ?? [])).not.toContain('<all_urls>');
  });

  it('uses programmatic injection for source tabs instead of running on every page', () => {
    expect(manifest.permissions ?? []).toContain('scripting');
    expect(manifest.permissions ?? []).not.toContain('tabs');
    expect(manifest.host_permissions ?? []).toContain('<all_urls>');
  });

  it('can observe embedded player frame navigations for source tabs', () => {
    expect(manifest.permissions ?? []).toContain('webNavigation');
  });

  it('leaves profile keys to package generation', () => {
    expect(manifest.key).toBeUndefined();
  });

  it('keeps the packaged extension version aligned with the app requirement', () => {
    expect(manifest.version).toBe(sharedVersion);
    expect(manifest.version).toBe(SOURCE_EXTENSION_REQUIRED_VERSION);
  });
});

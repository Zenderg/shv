import { afterEach, describe, expect, test, vi } from 'vitest';
import { BrowserAnalyzer } from '../../src/server/browser-analyzer/browserAnalyzer.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';

describe('BrowserAnalyzer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('marks a confident redirect target as the automatic candidate', async () => {
    const redirectedUrl = 'https://cdn.example.test/video.mp4';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      headers: new Headers({
        'content-length': '1234',
        'content-type': 'video/mp4'
      }),
      url: redirectedUrl
    } as Response);

    const result = await new BrowserAnalyzer(config()).analyze('https://example.test/video', 'job-id');

    expect(result.automaticCandidateUrl).toBe(redirectedUrl);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        sizeBytes: 1234,
        url: redirectedUrl
      })
    ]);
  });
});

function config(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    libraryRoot: '/tmp/library',
    appDataRoot: '/tmp/app',
    thumbnailsRoot: '/tmp/app/thumbnails',
    browserDataRoot: '/tmp/app/browser',
    sourceExtensionProfile: 'prod',
    workRoot: '/tmp/work',
    databasePath: '/tmp/app/db.sqlite',
    chromiumExecutablePath: undefined,
    ytDlpCookiesPath: '/tmp/app/youtube-cookies.txt',
    downloadStallTimeoutMs: 120_000
  };
}

import { describe, expect, test } from 'vitest';
import { loadAppConfig } from '../../src/server/config/appConfig.js';

describe('loadAppConfig', () => {
  test('ignores a blank Chromium executable override', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app',
      CHROMIUM_EXECUTABLE_PATH: '   '
    } as NodeJS.ProcessEnv);

    expect(config.chromiumExecutablePath).toBeUndefined();
  });

  test('defaults the yt-dlp cookie file to app data storage', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app'
    } as NodeJS.ProcessEnv);

    expect(config.ytDlpCookiesPath).toBe('/data/app/youtube-cookies.txt');
  });

  test('allows overriding the yt-dlp cookie file path', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app',
      YTDLP_COOKIES_FILE: '/cookies/youtube.txt'
    } as NodeJS.ProcessEnv);

    expect(config.ytDlpCookiesPath).toBe('/cookies/youtube.txt');
  });

  test('normalizes the public app origin override', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app',
      PUBLIC_APP_ORIGIN: 'https://prod.example.test/app'
    } as NodeJS.ProcessEnv);

    expect(config.publicOrigin).toBe('https://prod.example.test');
  });

  test('allows overriding the download stall timeout', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app',
      DOWNLOAD_STALL_TIMEOUT_MS: '45000'
    } as NodeJS.ProcessEnv);

    expect(config.downloadStallTimeoutMs).toBe(45_000);
  });

  test('defaults to the production source extension profile', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app'
    } as NodeJS.ProcessEnv);

    expect(config.sourceExtensionProfile).toBe('prod');
  });

  test('allows opting into the development source extension profile', () => {
    const config = loadAppConfig({
      APP_DATA_ROOT: '/data/app',
      SOURCE_EXTENSION_PROFILE: 'dev'
    } as NodeJS.ProcessEnv);

    expect(config.sourceExtensionProfile).toBe('dev');
  });
});

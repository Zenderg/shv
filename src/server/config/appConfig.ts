import path from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  publicOrigin?: string;
  libraryRoot: string;
  appDataRoot: string;
  thumbnailsRoot: string;
  browserDataRoot: string;
  workRoot: string;
  databasePath: string;
  chromiumExecutablePath: string | undefined;
  ytDlpCookiesPath: string | undefined;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appDataRoot = path.resolve(env.APP_DATA_ROOT ?? '/data/app');
  const chromiumExecutablePath = env.CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const ytDlpCookiesPath = env.YTDLP_COOKIES_FILE?.trim() || path.join(appDataRoot, 'youtube-cookies.txt');
  const publicOrigin = normalizePublicOrigin(env.PUBLIC_APP_ORIGIN);
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    publicOrigin,
    libraryRoot: path.resolve(env.LIBRARY_ROOT ?? '/data/library'),
    appDataRoot,
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    browserDataRoot: path.join(appDataRoot, 'browser'),
    workRoot: path.resolve(env.WORK_ROOT ?? '/work'),
    databasePath: path.join(appDataRoot, 'shv.sqlite'),
    chromiumExecutablePath,
    ytDlpCookiesPath
  };
}

function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_ORIGIN must use http or https');
  }
  return parsed.origin;
}

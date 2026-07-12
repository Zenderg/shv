import path from 'node:path';
import type { SourceExtensionKind } from '../../shared/sourceExtension.js';

export interface AppConfig {
  host: string;
  port: number;
  publicOrigin?: string;
  sourceExtensionProfile: SourceExtensionKind;
  libraryRoot: string;
  appDataRoot: string;
  thumbnailsRoot: string;
  browserDataRoot: string;
  workRoot: string;
  databasePath: string;
  chromiumExecutablePath: string | undefined;
  ytDlpCookiesPath: string | undefined;
  downloadStallTimeoutMs?: number;
  maxConcurrentJobs?: number;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appDataRoot = path.resolve(env.APP_DATA_ROOT ?? '/data/app');
  const chromiumExecutablePath = env.CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const ytDlpCookiesPath = env.YTDLP_COOKIES_FILE?.trim() || path.join(appDataRoot, 'youtube-cookies.txt');
  const publicOrigin = normalizePublicOrigin(env.PUBLIC_APP_ORIGIN);
  const sourceExtensionProfile = normalizeSourceExtensionProfile(env.SOURCE_EXTENSION_PROFILE);
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    publicOrigin,
    sourceExtensionProfile,
    libraryRoot: path.resolve(env.LIBRARY_ROOT ?? '/data/library'),
    appDataRoot,
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    browserDataRoot: path.join(appDataRoot, 'browser'),
    workRoot: path.resolve(env.WORK_ROOT ?? '/work'),
    databasePath: path.join(appDataRoot, 'shv.sqlite'),
    chromiumExecutablePath,
    ytDlpCookiesPath,
    downloadStallTimeoutMs: positiveNumber(env.DOWNLOAD_STALL_TIMEOUT_MS, 120_000),
    maxConcurrentJobs: positiveInteger(env.MAX_CONCURRENT_JOBS, 2)
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

function normalizeSourceExtensionProfile(value: string | undefined): SourceExtensionKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return 'prod';
  }
  if (normalized === 'prod' || normalized === 'dev') {
    return normalized;
  }
  throw new Error('SOURCE_EXTENSION_PROFILE must be prod or dev');
}

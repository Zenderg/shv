import type { MediaItem } from '../lib/api';

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDuration(value: number | null): string {
  if (!value) {
    return 'unknown length';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatResolution(item: Pick<MediaItem, 'height' | 'width'>): string {
  return item.width && item.height ? `${item.width}x${item.height}` : 'unknown resolution';
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

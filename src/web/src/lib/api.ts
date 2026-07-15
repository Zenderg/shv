import type { SourceExtensionKind } from '../../../shared/sourceExtension';
import type { Category, DownloadJob, JobStatus, MediaCandidate, MediaItem, MediaPage, QueueSnapshot, SubtitleTrack } from '../../../shared/types';

export interface RuntimeConfig {
  csrfToken: string;
  sourceExtensionProfile: SourceExtensionKind;
}

export interface LiveBrowserState {
  jobId: string;
  running: boolean;
  currentUrl: string | null;
  title: string | null;
  width: number;
  height: number;
  updatedAt: string;
  errorMessage: string | null;
}

const CSRF_HEADER_NAME = 'X-SHV-CSRF';
let csrfToken: string | null = null;
let runtimeConfigRequest: Promise<RuntimeConfig> | null = null;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined)
  };
  if (unsafeMethod(options?.method)) {
    headers[CSRF_HEADER_NAME] = csrfToken ?? (await fetchRuntimeConfig()).csrfToken;
  }
  const response = await fetch(url, {
    ...options,
    headers
  });
  if (!response.ok) {
    const body = await response.text();
    throw new ApiRequestError(apiErrorMessage(body, response.status), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function apiErrorMessage(body: string, status: number): string {
  if (!body) {
    return `Request failed with HTTP ${status}`;
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error.replaceAll('_', ' ');
    }
  } catch {
    // The server may deliberately return a plain-text error.
  }
  return body;
}

async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigRequest ??= fetch('/api/runtime-config', {
    headers: { 'Content-Type': 'application/json' }
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed with HTTP ${response.status}`);
    }
    const config = (await response.json()) as RuntimeConfig;
    csrfToken = config.csrfToken;
    return config;
  }).finally(() => {
    runtimeConfigRequest = null;
  });
  return runtimeConfigRequest;
}

function unsafeMethod(method: string | undefined): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase());
}

export const api = {
  runtimeConfig: () => fetchRuntimeConfig(),
  categories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string) => request<Category>('/api/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCategory: (id: string, name: string) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  media: (categoryId: string, cursor: string | null = null, limit = 60) => {
    const params = new URLSearchParams({ categoryId, limit: String(limit) });
    if (cursor) {
      params.set('cursor', cursor);
    }
    return request<MediaPage>(`/api/media?${params.toString()}`);
  },
  updateMedia: (id: string, body: { title?: string; categoryId?: string }) =>
    request<MediaItem>(`/api/media/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: 'DELETE' }),
  queue: () => request<QueueSnapshot>('/api/queue'),
  job: async (id: string): Promise<DownloadJob | null> => {
    try {
      return await request<DownloadJob>(`/api/jobs/${id}`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  createJob: (sourceUrl: string, categoryId: string) =>
    request<DownloadJob>('/api/jobs', { method: 'POST', body: JSON.stringify({ sourceUrl, categoryId }) }),
  retryJob: (id: string) => request<DownloadJob>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => request<DownloadJob>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  deleteJob: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  selectCandidate: (id: string, candidateId: string) =>
    request<DownloadJob>(`/api/jobs/${id}/select-candidate`, { method: 'POST', body: JSON.stringify({ candidateId }) }),
  selectSubtitleTrack: (id: string, subtitleTrackUrl: string | null) =>
    request<DownloadJob>(`/api/jobs/${id}/select-subtitle-track`, { method: 'POST', body: JSON.stringify({ subtitleTrackUrl }) }),
  replaceSource: (id: string, sourceUrl: string) =>
    request<DownloadJob>(`/api/jobs/${id}/replace-source`, { method: 'POST', body: JSON.stringify({ sourceUrl }) }),
  liveBrowser: {
    state: (id: string) => request<LiveBrowserState>(`/api/jobs/${id}/browser`),
    start: (id: string) => request<LiveBrowserState>(`/api/jobs/${id}/browser/start`, { method: 'POST' }),
    stop: (id: string) => request<void>(`/api/jobs/${id}/browser/stop`, { method: 'POST' }),
    click: (id: string, x: number, y: number) =>
      request<LiveBrowserState>(`/api/jobs/${id}/browser/click`, { method: 'POST', body: JSON.stringify({ x, y }) }),
    scroll: (id: string, deltaY: number) =>
      request<LiveBrowserState>(`/api/jobs/${id}/browser/scroll`, { method: 'POST', body: JSON.stringify({ deltaY }) }),
    highlight: (id: string, candidateId: string | null) =>
      request<LiveBrowserState>(`/api/jobs/${id}/browser/highlight`, { method: 'POST', body: JSON.stringify({ candidateId }) })
  }
};

export type { Category, DownloadJob, JobStatus, MediaCandidate, MediaItem, MediaPage, QueueSnapshot, SubtitleTrack };

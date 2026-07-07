import type { SourceExtensionKind } from '../../../shared/sourceExtension';
import type { Category, DownloadJob, MediaCandidate, MediaItem, QueueSnapshot } from '../../../shared/types';

export interface RuntimeConfig {
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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  runtimeConfig: () => request<RuntimeConfig>('/api/runtime-config'),
  categories: () => request<Category[]>('/api/categories'),
  createCategory: (name: string) => request<Category>('/api/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCategory: (id: string, name: string) =>
    request<Category>(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: 'DELETE' }),
  media: (categoryId?: string) => request<MediaItem[]>(categoryId ? `/api/media?categoryId=${categoryId}` : '/api/media'),
  updateMedia: (id: string, body: { title?: string; categoryId?: string }) =>
    request<MediaItem>(`/api/media/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMedia: (id: string) => request<void>(`/api/media/${id}`, { method: 'DELETE' }),
  queue: () => request<QueueSnapshot>('/api/queue'),
  createJob: (sourceUrl: string, categoryId: string) =>
    request<DownloadJob>('/api/jobs', { method: 'POST', body: JSON.stringify({ sourceUrl, categoryId }) }),
  retryJob: (id: string) => request<DownloadJob>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => request<DownloadJob>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  deleteJob: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  selectCandidate: (id: string, candidateId: string) =>
    request<DownloadJob>(`/api/jobs/${id}/select-candidate`, { method: 'POST', body: JSON.stringify({ candidateId }) }),
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

export type { Category, DownloadJob, MediaCandidate, MediaItem, QueueSnapshot };

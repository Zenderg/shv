import { writable } from 'svelte/store';

export type Candidate = {
  bitrate: number | null;
  confidence: number;
  contentType: string | null;
  durationSeconds: number | null;
  headers: Record<string, string>;
  kind: string;
  manifestType: string | null;
  resolution: string | null;
  sizeBytes: number | null;
  subtitleTracks?: SubtitleTrack[];
  url: string;
};

export type SubtitleTrack = {
  contentType: string | null;
  format: 'webvtt' | 'srt' | 'ass' | 'hls' | 'unknown';
  isDefault: boolean | null;
  isSelected: boolean | null;
  label: string | null;
  language: string | null;
  source: 'network' | 'text-track' | 'hls-manifest';
  url: string;
};

export type SourceSession = {
  activeCaptureUntil: number | null;
  activePlaybackUntil?: number | null;
  activePlaybackMetadata?: {
    currentSrc: string | null;
    durationSeconds: number | null;
    resolution: string | null;
  } | null;
  candidates: Candidate[];
  currentUrl?: string | null;
  diagnostics?: {
    network?: Record<string, unknown>;
    playback?: Record<string, unknown> | null;
  };
  jobId: string;
  playbackState?: 'active' | 'inactive' | null;
  selectedUrl?: string | null;
  sourceUrl: string;
  status: string;
  subtitleTracks?: SubtitleTrack[];
  titleHint?: string | null;
  updatedAt?: string;
};

export type SidebarView = {
  capturePending: boolean;
  collapsed: boolean;
  highlightedUrl: string | null;
  probingResolutionUrls: string[];
  resolutionUnavailableUrls: string[];
  selectingUrls: string[];
  selectionError: string | null;
  session: SourceSession | null;
  status: string;
};

export const sidebarView = writable<SidebarView>({
  capturePending: false,
  collapsed: false,
  highlightedUrl: null,
  probingResolutionUrls: [],
  resolutionUnavailableUrls: [],
  selectingUrls: [],
  selectionError: null,
  session: null,
  status: 'Opening...'
});

type SidebarActions = {
  clearHighlight: () => void;
  close: () => void;
  highlight: (url: string) => void;
  selectSource: (url: string) => void;
  startCapture: () => void;
  toggleCollapsed: () => void;
};

export const sidebarActions: SidebarActions = {
  clearHighlight: () => undefined,
  close: () => undefined,
  highlight: (_url: string) => undefined,
  selectSource: (_url: string) => undefined,
  startCapture: () => undefined,
  toggleCollapsed: () => undefined
};

export function setSidebarActions(actions: Partial<SidebarActions>) {
  Object.assign(sidebarActions, actions);
}

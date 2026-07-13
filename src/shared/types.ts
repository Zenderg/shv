export type JobStatus =
  | 'pending'
  | 'analyzing'
  | 'needs_manual_selection'
  | 'needs_subtitle_selection'
  | 'downloading'
  | 'processing'
  | 'adding_subtitles'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface Category {
  id: string;
  name: string;
  folderName: string;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  categoryId: string;
  title: string;
  filename: string;
  relativePath: string;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadJob {
  id: string;
  sourceUrl: string;
  categoryId: string;
  status: JobStatus;
  selectedCandidateId: string | null;
  titleHint: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  stageProgress: number | null;
  progressLabel: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SubtitleTrack {
  url: string;
  contentType: string | null;
  format: 'webvtt' | 'srt' | 'ass' | 'hls' | 'unknown';
  language: string | null;
  label: string | null;
  isDefault: boolean | null;
  isSelected: boolean | null;
  source: 'network' | 'text-track' | 'hls-manifest';
  headers?: Record<string, string>;
  localPath?: string;
}

export interface MediaCandidate {
  id: string;
  jobId: string;
  kind: 'direct' | 'hls' | 'dash' | 'html-video' | 'browser-request';
  url: string;
  contentType: string | null;
  manifestType: 'hls' | 'dash' | null;
  resolution: string | null;
  bitrate: number | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  confidence: number;
  headers: Record<string, string>;
  subtitleTracks: SubtitleTrack[];
  discoveredAt: string;
}

export interface QueueSnapshot {
  jobs: DownloadJob[];
  candidatesByJobId: Record<string, MediaCandidate[]>;
}

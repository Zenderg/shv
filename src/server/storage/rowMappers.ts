import type { Category, DownloadJob, JobStatus, MediaCandidate, MediaItem, SubtitleTrack } from '../../shared/types.js';
import { parseJsonObject } from './database.js';

type Row = Record<string, unknown>;

export function mapCategory(row: Row): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    folderName: String(row.folder_name),
    createdAt: String(row.created_at)
  };
}

export function mapMediaItem(row: Row): MediaItem {
  return {
    id: String(row.id),
    categoryId: String(row.category_id),
    title: String(row.title),
    filename: String(row.filename),
    relativePath: String(row.relative_path),
    thumbnailPath: row.thumbnail_path === null ? null : String(row.thumbnail_path),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    sizeBytes: Number(row.size_bytes),
    container: row.container === null ? null : String(row.container),
    videoCodec: row.video_codec === null ? null : String(row.video_codec),
    audioCodec: row.audio_codec === null ? null : String(row.audio_codec),
    sourceUrl: String(row.source_url),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapDownloadJob(row: Row): DownloadJob {
  return {
    id: String(row.id),
    sourceUrl: String(row.source_url),
    categoryId: String(row.category_id),
    status: String(row.status) as JobStatus,
    selectedCandidateId: row.selected_candidate_id === null ? null : String(row.selected_candidate_id),
    titleHint: row.title_hint === null ? null : String(row.title_hint),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    stageProgress: row.stage_progress === null || row.stage_progress === undefined ? null : Number(row.stage_progress),
    progressLabel: row.progress_label === null || row.progress_label === undefined ? null : String(row.progress_label),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at)
  };
}

export function mapMediaCandidate(row: Row): MediaCandidate {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    kind: String(row.kind) as MediaCandidate['kind'],
    url: String(row.url),
    contentType: row.content_type === null ? null : String(row.content_type),
    manifestType: row.manifest_type === null ? null : (String(row.manifest_type) as MediaCandidate['manifestType']),
    resolution: row.resolution === null ? null : String(row.resolution),
    bitrate: row.bitrate === null ? null : Number(row.bitrate),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    confidence: Number(row.confidence),
    headers: parseJsonObject(row.headers_json === null ? null : String(row.headers_json)),
    subtitleTracks: parseSubtitleTracks(row.subtitle_tracks_json === null || row.subtitle_tracks_json === undefined ? null : String(row.subtitle_tracks_json)),
    discoveredAt: String(row.discovered_at)
  };
}

function parseSubtitleTracks(value: string | null): SubtitleTrack[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSubtitleTrack);
  } catch {
    return [];
  }
}

function isSubtitleTrack(value: unknown): value is SubtitleTrack {
  const track = value as Partial<SubtitleTrack> | null;
  return Boolean(
    track &&
      typeof track.url === 'string' &&
      (track.contentType === null || typeof track.contentType === 'string') &&
      typeof track.format === 'string' &&
      (track.language === null || typeof track.language === 'string') &&
      (track.label === null || typeof track.label === 'string') &&
      (track.isDefault === null || typeof track.isDefault === 'boolean') &&
      (track.isSelected === null || typeof track.isSelected === 'boolean') &&
      typeof track.source === 'string'
  );
}

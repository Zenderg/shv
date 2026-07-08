declare module '*extension/chrome-source-helper/shared.js' {
  export const APP_ORIGIN: string;
  export const PROTOCOL_VERSION: number;
  export function candidateFromUrl(
    url: string,
    contentType?: string | null,
    kindOverride?: string | null,
    baseUrl?: string
  ): {
    bitrate: number | null;
    confidence: number;
    contentType: string | null;
    durationSeconds: number | null;
    headers: Record<string, string>;
    kind: string;
    manifestType: string | null;
    resolution: string | null;
    sizeBytes: number | null;
    subtitleTracks: Array<{
      contentType: string | null;
      format: 'webvtt' | 'srt' | 'ass' | 'hls' | 'unknown';
      isDefault: boolean | null;
      isSelected: boolean | null;
      label: string | null;
      language: string | null;
      source: 'network' | 'text-track' | 'hls-manifest';
      url: string;
    }>;
    url: string;
  } | null;
  export function candidateFromVerifiedVideoUrl(
    url: string,
    kindOverride?: string,
    baseUrl?: string
  ): {
    bitrate: number | null;
    confidence: number;
    contentType: string | null;
    durationSeconds: number | null;
    headers: Record<string, string>;
    kind: string;
    manifestType: string | null;
    resolution: string | null;
    sizeBytes: number | null;
    subtitleTracks: Array<{
      contentType: string | null;
      format: 'webvtt' | 'srt' | 'ass' | 'hls' | 'unknown';
      isDefault: boolean | null;
      isSelected: boolean | null;
      label: string | null;
      language: string | null;
      source: 'network' | 'text-track' | 'hls-manifest';
      url: string;
    }>;
    url: string;
  } | null;
  export function subtitleTrackFromUrl(
    url: string,
    contentType?: string | null,
    source?: 'network' | 'text-track' | 'hls-manifest',
    baseUrl?: string
  ): {
    contentType: string | null;
    format: 'webvtt' | 'srt' | 'ass' | 'hls' | 'unknown';
    isDefault: boolean | null;
    isSelected: boolean | null;
    label: string | null;
    language: string | null;
    source: 'network' | 'text-track' | 'hls-manifest';
    url: string;
  } | null;
}

declare module '*extension/chrome-source-helper/shared.js' {
  export const PROTOCOL_VERSION: number;
  export function candidateFromUrl(
    url: string,
    contentType?: string | null,
    kindOverride?: string | null
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
    url: string;
  } | null;
}

import type { JobStatus } from '../../shared/types.js';

export type FailingJobStage = Extract<
  JobStatus,
  'analyzing' | 'downloading' | 'processing' | 'adding_subtitles'
> | 'finalizing';

export type JobFailureCode =
  | 'analysis_failed'
  | 'download_failed'
  | 'finalization_failed'
  | 'network_interrupted'
  | 'processing_failed'
  | 'subtitle_failed';

export function classifyJobFailure(stage: FailingJobStage, error: unknown): JobFailureCode {
  if (isInterruptedNetworkFailure(error)) {
    return 'network_interrupted';
  }

  switch (stage) {
    case 'analyzing':
      return 'analysis_failed';
    case 'downloading':
      return 'download_failed';
    case 'processing':
      return 'processing_failed';
    case 'adding_subtitles':
      return 'subtitle_failed';
    case 'finalizing':
      return 'finalization_failed';
  }
}

function isInterruptedNetworkFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'DownloadStalledError') {
    return true;
  }

  const code = nodeErrorCode(error);
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:fetch failed|network (?:error|connection)|socket hang up|timed? out)\b/i.test(message);
}

function nodeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toUpperCase() : null;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT'
]);

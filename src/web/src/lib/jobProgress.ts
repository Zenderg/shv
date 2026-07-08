export interface JobProgressInput {
  progress: number;
  status: string;
}

export interface StageProgress {
  label: string;
  value: number;
}

export function jobStageProgress(job: JobProgressInput): StageProgress {
  switch (job.status) {
    case 'pending':
      return { label: 'Waiting', value: 0 };
    case 'analyzing':
      return { label: 'Analyzing', value: progressWithin(job.progress, 0.05, 0.2) };
    case 'needs_manual_selection':
      return { label: 'Manual selection', value: 1 };
    case 'needs_subtitle_selection':
      return { label: 'Subtitle selection', value: 1 };
    case 'downloading':
      return { label: 'Downloading', value: progressWithin(job.progress, 0.22, 0.77) };
    case 'processing':
      return { label: 'Processing', value: progressWithin(job.progress, 0.82, 0.98) };
    case 'completed':
      return { label: 'Completed', value: 1 };
    case 'failed':
      return { label: 'Failed', value: 0 };
    case 'canceled':
      return { label: 'Canceled', value: 0 };
    default:
      return { label: 'Waiting', value: 0 };
  }
}

function progressWithin(progress: number, start: number, end: number): number {
  return clamp01((clamp01(progress) - start) / (end - start));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

export interface JobProgressInput {
  stageProgress: number | null;
  progressLabel: string | null;
  status: string;
}

export interface StageProgress {
  label: string;
  value: number | null;
}

export function jobStageProgress(job: JobProgressInput): StageProgress {
  return {
    label: job.progressLabel ?? defaultProgressLabel(job.status),
    value: normalizedProgress(job.stageProgress)
  };
}

export function formatProgressPercent(value: number): string {
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  if (normalized === 1) {
    return '100%';
  }
  const percent = normalized * 100;
  if (percent > 0 && percent < 0.1) {
    return '<0.1%';
  }
  if (percent > 0 && percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.min(99, Math.round(percent))}%`;
}

function defaultProgressLabel(status: string): string {
  if (status === 'analyzing') return 'Analyzing source';
  if (status === 'downloading') return 'Downloading';
  if (status === 'processing') return 'Preparing video';
  if (status === 'adding_subtitles') return 'Adding subtitles';
  return 'Working';
}

function normalizedProgress(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

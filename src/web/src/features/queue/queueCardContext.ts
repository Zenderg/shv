import type { DownloadJob } from '../../lib/api';

export function queuePositionByJobId(jobs: Array<Pick<DownloadJob, 'createdAt' | 'id' | 'status'>>): Record<string, number> {
  const pending = jobs
    .filter((job) => job.status === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  return Object.fromEntries(pending.map((job, index) => [job.id, index + 1]));
}

export function jobProgressContext(status: string, pendingPosition?: number): string {
  if (status === 'pending') {
    const position = pendingPosition ?? 1;
    return position === 1
      ? 'Waiting for an available slot · next to start'
      : `Waiting for an available slot · ${ordinal(position)} in line`;
  }
  if (status === 'analyzing') return 'Step 1 · Analyze source';
  if (status === 'downloading') return 'Step 2 · Download media';
  if (status === 'processing') return 'Step 3 · Prepare for the library';
  if (status === 'adding_subtitles') return 'Optional final step · Add subtitles';
  if (status === 'needs_manual_selection') return 'Waiting for you · Choose a source';
  if (status === 'needs_subtitle_selection') return 'Waiting for you · Choose subtitles';
  if (status === 'failed') return 'Stopped · Retry or choose another source';
  if (status === 'canceled') return 'Stopped by you · Retry to start again';
  return 'Status update';
}

function ordinal(value: number): string {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

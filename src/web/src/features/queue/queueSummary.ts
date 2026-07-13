import type { DownloadJob } from '../../lib/api';

export interface QueueCounts {
  active: number;
  attention: number;
  canceled: number;
  pending: number;
  total: number;
}

const ACTIVE_STATUSES = new Set(['analyzing', 'downloading', 'processing', 'adding_subtitles']);
const ATTENTION_STATUSES = new Set(['failed', 'needs_manual_selection', 'needs_subtitle_selection']);

export function countQueueJobs(jobs: Array<Pick<DownloadJob, 'status'>>): QueueCounts {
  const counts: QueueCounts = { active: 0, attention: 0, canceled: 0, pending: 0, total: jobs.length };

  for (const job of jobs) {
    if (ACTIVE_STATUSES.has(job.status)) {
      counts.active += 1;
    } else if (ATTENTION_STATUSES.has(job.status)) {
      counts.attention += 1;
    } else if (job.status === 'pending') {
      counts.pending += 1;
    } else if (job.status === 'canceled') {
      counts.canceled += 1;
    }
  }

  return counts;
}

export function queueCountsLabel(counts: QueueCounts): string {
  const parts = [
    countLabel(counts.active, 'active'),
    countLabel(counts.pending, 'waiting'),
    counts.attention > 0 ? `${counts.attention} ${counts.attention === 1 ? 'needs' : 'need'} attention` : null,
    countLabel(counts.canceled, 'canceled')
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' · ') : 'No current queue items';
}

function countLabel(count: number, label: string): string | null {
  return count > 0 ? `${count} ${label}` : null;
}

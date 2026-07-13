import type { DownloadJob } from '../../lib/api';

type VisibleQueueJob = Pick<DownloadJob, 'categoryId' | 'id'>;

export interface CompletedJobResolution<T> {
  completed: T[];
  discarded: T[];
  retry: T[];
}

export function removedJobCategoryIds(
  previousJobs: VisibleQueueJob[],
  currentJobs: VisibleQueueJob[]
): string[] {
  const currentJobIds = new Set(currentJobs.map((job) => job.id));
  return [
    ...new Set(
      previousJobs
        .filter((job) => !currentJobIds.has(job.id))
        .map((job) => job.categoryId)
    )
  ];
}

export function disappearedQueueJobs<T extends VisibleQueueJob>(
  previousJobs: T[],
  currentJobs: VisibleQueueJob[]
): T[] {
  const currentJobIds = new Set(currentJobs.map((job) => job.id));
  return previousJobs.filter((job) => !currentJobIds.has(job.id));
}

export async function resolveCompletedJobs<T extends VisibleQueueJob>(
  disappearedJobs: T[],
  loadJob: (jobId: string) => Promise<Pick<DownloadJob, 'status'> | null>
): Promise<CompletedJobResolution<T>> {
  const outcomes = await Promise.all(
    disappearedJobs.map(async (job) => {
      try {
        return (await loadJob(job.id))?.status === 'completed' ? 'completed' : 'discarded';
      } catch {
        return 'retry';
      }
    })
  );
  return {
    completed: disappearedJobs.filter((_job, index) => outcomes[index] === 'completed'),
    discarded: disappearedJobs.filter((_job, index) => outcomes[index] === 'discarded'),
    retry: disappearedJobs.filter((_job, index) => outcomes[index] === 'retry')
  };
}

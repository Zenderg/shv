import type { DownloadJob } from '../../lib/api';

type VisibleQueueJob = Pick<DownloadJob, 'categoryId' | 'id'>;

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

export async function confirmedCompletedJobs<T extends VisibleQueueJob>(
  disappearedJobs: T[],
  loadJob: (jobId: string) => Promise<Pick<DownloadJob, 'status'>>
): Promise<T[]> {
  const completed = await Promise.all(
    disappearedJobs.map(async (job) => {
      try {
        return (await loadJob(job.id)).status === 'completed';
      } catch {
        return false;
      }
    })
  );
  return disappearedJobs.filter((_job, index) => completed[index]);
}

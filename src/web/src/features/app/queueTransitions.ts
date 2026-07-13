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
  currentJobs: VisibleQueueJob[],
  excludedJobIds: ReadonlySet<string> = new Set()
): T[] {
  const currentJobIds = new Set(currentJobs.map((job) => job.id));
  return previousJobs.filter((job) => !currentJobIds.has(job.id) && !excludedJobIds.has(job.id));
}

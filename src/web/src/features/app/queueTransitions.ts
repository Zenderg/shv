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

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Category, DownloadJob, QueueSnapshot } from '../../lib/api';
import { api } from '../../lib/api';
import type { CompletionNotice } from '../queue/CompletionToasts';
import { appQueryKeys } from './queries';
import { disappearedQueueJobs, removedJobCategoryIds, resolveCompletedJobs } from './queueTransitions';

interface QueueCompletionNotificationOptions {
  categories: Category[];
  queue: QueueSnapshot | undefined;
  queueDataUpdatedAt: number;
}

export function useQueueCompletionNotifications({
  categories,
  queue,
  queueDataUpdatedAt
}: QueueCompletionNotificationOptions) {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState('');
  const [notices, setNotices] = useState<CompletionNotice[]>([]);
  const checkGenerationRef = useRef(0);
  const checksRef = useRef(new Set<string>());
  const notifiedJobIdsRef = useRef(new Set<string>());
  const pendingJobsRef = useRef(new Map<string, DownloadJob>());
  const previousVisibleJobsRef = useRef<DownloadJob[] | null>(null);

  useEffect(() => () => {
    checkGenerationRef.current += 1;
    checksRef.current.clear();
    pendingJobsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!queue) {
      return;
    }
    const previousJobs = previousVisibleJobsRef.current;
    previousVisibleJobsRef.current = queue.jobs;
    if (!previousJobs) {
      return;
    }

    // Reset infinite media queries to the first page so completed jobs appear at
    // the top without refetching every page accumulated during a long session.
    for (const categoryId of removedJobCategoryIds(previousJobs, queue.jobs)) {
      void queryClient.resetQueries({ exact: true, queryKey: appQueryKeys.media(categoryId) });
    }

    const currentJobIds = new Set(queue.jobs.map((job) => job.id));
    for (const jobId of pendingJobsRef.current.keys()) {
      if (currentJobIds.has(jobId)) {
        pendingJobsRef.current.delete(jobId);
      }
    }
    for (const job of disappearedQueueJobs(previousJobs, queue.jobs)) {
      if (!notifiedJobIdsRef.current.has(job.id)) {
        pendingJobsRef.current.set(job.id, job);
      }
    }

    const jobsToConfirm = [...pendingJobsRef.current.values()].filter(
      (job) => !checksRef.current.has(job.id)
    );
    if (jobsToConfirm.length === 0) {
      return;
    }

    for (const job of jobsToConfirm) {
      checksRef.current.add(job.id);
    }
    const generation = checkGenerationRef.current;
    void resolveCompletedJobs(jobsToConfirm, api.job).then(({ completed, discarded }) => {
      if (generation !== checkGenerationRef.current) {
        return;
      }
      const stillPendingCompletedJobs = completed.filter((job) => pendingJobsRef.current.has(job.id));
      for (const job of [...completed, ...discarded]) {
        pendingJobsRef.current.delete(job.id);
      }
      const newlyCompletedJobs = stillPendingCompletedJobs.filter(
        (job) => !notifiedJobIdsRef.current.has(job.id)
      );
      if (newlyCompletedJobs.length === 0) {
        return;
      }
      for (const job of newlyCompletedJobs) {
        notifiedJobIdsRef.current.add(job.id);
      }
      const nextNotices = newlyCompletedJobs.map((job) => {
        const categoryName = categories.find((category) => category.id === job.categoryId)?.name ?? 'your library';
        return {
          categoryId: job.categoryId,
          categoryName,
          jobId: job.id,
          title: job.titleHint || safeHostname(job.sourceUrl)
        };
      });
      setNotices((current) => [
        ...nextNotices,
        ...current.filter((notice) => !nextNotices.some((next) => next.jobId === notice.jobId))
      ].slice(0, 4));
      setAnnouncement(
        nextNotices.length === 1
          ? `${nextNotices[0].title} finished downloading and was saved to ${nextNotices[0].categoryName}.`
          : `${nextNotices.length} downloads finished and were saved to the library.`
      );
    }).finally(() => {
      for (const job of jobsToConfirm) {
        checksRef.current.delete(job.id);
      }
    });
  }, [categories, queryClient, queue, queueDataUpdatedAt]);

  return {
    announcement,
    dismiss: (jobId: string) => setNotices((current) => current.filter((notice) => notice.jobId !== jobId)),
    notices
  };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname || 'Completed download';
  } catch {
    return 'Completed download';
  }
}

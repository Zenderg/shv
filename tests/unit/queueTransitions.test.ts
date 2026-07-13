import { describe, expect, test } from 'vitest';
import { confirmedCompletedJobs, disappearedQueueJobs, removedJobCategoryIds } from '../../src/web/src/features/app/queueTransitions.js';

describe('queue transitions', () => {
  test('returns the category of a job that disappeared from the visible queue', () => {
    expect(removedJobCategoryIds(
      [{ id: 'job-1', categoryId: 'category-1' }],
      []
    )).toEqual(['category-1']);
  });

  test('does not refresh media when visible jobs only change status or progress', () => {
    expect(removedJobCategoryIds(
      [{ id: 'job-1', categoryId: 'category-1' }],
      [{ id: 'job-1', categoryId: 'category-1' }]
    )).toEqual([]);
  });

  test('deduplicates categories when several jobs disappear together', () => {
    expect(removedJobCategoryIds(
      [
        { id: 'job-1', categoryId: 'category-1' },
        { id: 'job-2', categoryId: 'category-1' },
        { id: 'job-3', categoryId: 'category-2' }
      ],
      []
    )).toEqual(['category-1', 'category-2']);
  });

  test('returns all disappeared jobs so the caller can confirm their final status', () => {
    const completed = { id: 'job-completed', categoryId: 'category-1', title: 'Finished video' };
    const deleted = { id: 'job-deleted', categoryId: 'category-2', title: 'Canceled video' };

    expect(disappearedQueueJobs([completed, deleted], [])).toEqual([completed, deleted]);
  });

  test('confirms completion with the job endpoint and ignores deleted or non-completed jobs', async () => {
    const completed = { id: 'job-completed', categoryId: 'category-1' };
    const deleted = { id: 'job-deleted', categoryId: 'category-2' };
    const canceled = { id: 'job-canceled', categoryId: 'category-3' };

    await expect(confirmedCompletedJobs([completed, deleted, canceled], async (jobId) => {
      if (jobId === deleted.id) {
        throw new Error('Job not found');
      }
      return { status: jobId === completed.id ? 'completed' : 'canceled' };
    })).resolves.toEqual([completed]);
  });
});

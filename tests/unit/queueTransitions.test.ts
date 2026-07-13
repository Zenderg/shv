import { describe, expect, test } from 'vitest';
import { disappearedQueueJobs, removedJobCategoryIds, resolveCompletedJobs } from '../../src/web/src/features/app/queueTransitions.js';

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

  test('confirms completion, resolves deleted jobs, and keeps transient failures for retry', async () => {
    const completed = { id: 'job-completed', categoryId: 'category-1' };
    const deleted = { id: 'job-deleted', categoryId: 'category-2' };
    const canceled = { id: 'job-canceled', categoryId: 'category-3' };
    const transient = { id: 'job-transient', categoryId: 'category-4' };

    await expect(resolveCompletedJobs([completed, deleted, canceled, transient], async (jobId) => {
      if (jobId === deleted.id) {
        return null;
      }
      if (jobId === transient.id) {
        throw new Error('Temporary network failure');
      }
      return { status: jobId === completed.id ? 'completed' : 'canceled' };
    })).resolves.toEqual({
      completed: [completed],
      discarded: [deleted, canceled],
      retry: [transient]
    });
  });

  test('can confirm a pending completion on a later poll', async () => {
    const job = { id: 'job-completed-later', categoryId: 'category-1' };
    const firstPoll = await resolveCompletedJobs([job], async () => {
      throw new Error('Temporary network failure');
    });

    expect(firstPoll.retry).toEqual([job]);
    await expect(resolveCompletedJobs(firstPoll.retry, async () => ({ status: 'completed' }))).resolves.toEqual({
      completed: [job],
      discarded: [],
      retry: []
    });
  });
});

import { describe, expect, test } from 'vitest';
import { countQueueJobs, queueCountsLabel } from '../../src/web/src/features/queue/queueSummary.js';

describe('queue summary', () => {
  test('separates running, waiting, attention, and canceled jobs', () => {
    const counts = countQueueJobs([
      { status: 'analyzing' },
      { status: 'downloading' },
      { status: 'pending' },
      { status: 'failed' },
      { status: 'needs_manual_selection' },
      { status: 'canceled' }
    ]);

    expect(counts).toEqual({ active: 2, attention: 2, canceled: 1, pending: 1, total: 6 });
    expect(queueCountsLabel(counts)).toBe('2 active · 1 waiting · 2 need attention · 1 canceled');
  });

  test('does not call non-pending jobs queued when the queue has no current work', () => {
    expect(queueCountsLabel(countQueueJobs([]))).toBe('No current queue items');
  });
});

import { describe, expect, test } from 'vitest';
import { queueStatusGroup, sortQueueJobs } from '../../src/web/src/features/queue/queueStatus.js';

describe('queue status classification', () => {
  test('classifies a future status as attention', () => {
    expect(queueStatusGroup('waiting_for_device')).toBe('attention');
  });

  test('sorts subtitle processing with active jobs ahead of pending jobs', () => {
    const pending = { createdAt: '2026-01-01T00:00:00.000Z', id: 'pending', status: 'pending' };
    const subtitles = { createdAt: '2026-01-01T00:01:00.000Z', id: 'subtitles', status: 'adding_subtitles' };

    expect(sortQueueJobs([pending, subtitles])).toEqual([subtitles, pending]);
  });

  test('sorts an unknown attention status ahead of active work', () => {
    const active = { createdAt: '2026-01-01T00:00:00.000Z', id: 'active', status: 'downloading' };
    const unknown = { createdAt: '2026-01-01T00:01:00.000Z', id: 'unknown', status: 'waiting_for_device' };

    expect(sortQueueJobs([active, unknown])).toEqual([unknown, active]);
  });
});

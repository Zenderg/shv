import { describe, expect, test } from 'vitest';
import { jobProgressContext, queuePositionByJobId } from '../../src/web/src/features/queue/queueCardContext.js';

describe('queue card context', () => {
  test('uses FIFO creation order for pending positions independently of card sorting', () => {
    expect(queuePositionByJobId([
      { createdAt: '2026-01-01T00:02:00.000Z', id: 'second', status: 'pending' },
      { createdAt: '2026-01-01T00:00:00.000Z', id: 'active', status: 'downloading' },
      { createdAt: '2026-01-01T00:01:00.000Z', id: 'first', status: 'pending' }
    ])).toEqual({ first: 1, second: 2 });
  });

  test('explains the next pending job and later positions without inventing an ETA', () => {
    expect(jobProgressContext('pending', 1)).toBe('Waiting for an available slot · next to start');
    expect(jobProgressContext('pending', 12)).toBe('Waiting for an available slot · 12th in line');
  });

  test('labels progress as pipeline steps without creating an overall percentage', () => {
    expect(jobProgressContext('downloading')).toBe('Step 2 · Download media');
    expect(jobProgressContext('adding_subtitles')).toBe('Optional final step · Add subtitles');
  });
});

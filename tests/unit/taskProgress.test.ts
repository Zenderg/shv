import { describe, expect, test } from 'vitest';
import { progressLogMilestone } from '../../src/server/utils/taskProgress.js';

describe('task progress policy', () => {
  test.each([
    [0, 0],
    [0.149, 10],
    [0.949, 90],
    [0.95, 95],
    [0.989, 95],
    [0.99, 99],
    [1, 100],
    [2, 100],
    [Number.NaN, 0]
  ])('maps %s to log milestone %s', (progress, expected) => {
    expect(progressLogMilestone(progress)).toBe(expected);
  });
});

import { describe, expect, test } from 'vitest';
import { jobStageProgress } from '../../src/web/src/lib/jobProgress.js';

describe('queue job progress display', () => {
  test('renders subtitle selection as a known queue stage', () => {
    expect(jobStageProgress({ progress: 0.3, status: 'needs_subtitle_selection' })).toEqual({
      label: 'Subtitle selection',
      value: 1
    });
  });

  test('falls back to a safe stage for statuses added before the current UI knows them', () => {
    expect(jobStageProgress({ progress: 0.4, status: 'future_server_status' })).toEqual({
      label: 'Waiting',
      value: 0
    });
  });
});

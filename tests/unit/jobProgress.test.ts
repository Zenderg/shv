import { describe, expect, test } from 'vitest';
import { formatProgressPercent, jobStageProgress } from '../../src/web/src/lib/jobProgress.js';

describe('queue job progress display', () => {
  test('shows a direct current-stage percentage without synthetic overall weighting', () => {
    expect(jobStageProgress({ progressLabel: 'Downloading', stageProgress: 0.42, status: 'downloading' })).toEqual({
      label: 'Downloading',
      value: 0.42
    });
  });

  test('keeps stages indeterminate when no honest denominator is available', () => {
    expect(jobStageProgress({ progressLabel: null, stageProgress: null, status: 'downloading' })).toEqual({
      label: 'Downloading',
      value: null
    });
  });

  test('uses the explicit subtitle-processing stage', () => {
    expect(jobStageProgress({ progressLabel: null, stageProgress: 0.25, status: 'adding_subtitles' })).toEqual({
      label: 'Adding subtitles',
      value: 0.25
    });
  });

  test('clamps determinate values and rejects non-finite values', () => {
    expect(jobStageProgress({ progressLabel: null, stageProgress: 2, status: 'processing' }).value).toBe(1);
    expect(jobStageProgress({ progressLabel: null, stageProgress: Number.NaN, status: 'processing' }).value).toBeNull();
  });

  test('falls back safely for statuses added before the current UI knows them', () => {
    expect(jobStageProgress({ progressLabel: null, stageProgress: null, status: 'future_server_status' })).toEqual({
      label: 'Working',
      value: null
    });
  });

  test('does not display 100% before the step actually reaches one', () => {
    expect(formatProgressPercent(0.995)).toBe('99%');
    expect(formatProgressPercent(0.9999)).toBe('99%');
    expect(formatProgressPercent(1)).toBe('100%');
  });
});

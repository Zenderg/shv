import { describe, expect, test } from 'vitest';
import { classifyJobFailure } from '../../src/server/jobs/jobFailure.js';

describe('job failure classification', () => {
  test.each([
    ['analyzing', 'analysis_failed'],
    ['downloading', 'download_failed'],
    ['processing', 'processing_failed'],
    ['adding_subtitles', 'subtitle_failed'],
    ['finalizing', 'finalization_failed']
  ] as const)('maps %s failures to a phase-specific code', (stage, expected) => {
    expect(classifyJobFailure(stage, new Error('phase failed'))).toBe(expected);
  });

  test.each([
    Object.assign(new Error('read failed'), { code: 'ECONNRESET' }),
    new TypeError('fetch failed'),
    Object.assign(new Error('Download stalled'), { name: 'DownloadStalledError' })
  ])('recognizes interrupted network work', (error) => {
    expect(classifyJobFailure('downloading', error)).toBe('network_interrupted');
  });

  test('does not label an HTTP response as an interrupted connection', () => {
    expect(classifyJobFailure('downloading', new Error('Download failed with HTTP 404'))).toBe('download_failed');
  });
});

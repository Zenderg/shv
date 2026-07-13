import { describe, expect, test } from 'vitest';
import { buildYtDlpArgs, createYtDlpProgressTracker, isYouTubeUrl, YtDlpSourceExtractor } from '../../src/server/source-extractors/sourceExtractorService.js';

describe('source extractor service', () => {
  test('recognizes YouTube source URLs only', () => {
    const extractor = new YtDlpSourceExtractor();

    expect(extractor.canHandle('https://www.youtube.com/watch?v=test')).toBe(true);
    expect(extractor.canHandle('https://youtu.be/test')).toBe(true);
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=test')).toBe(true);
    expect(isYouTubeUrl('https://www.youtube-nocookie.com/embed/test')).toBe(true);
    expect(extractor.canHandle('https://example.test/video.mp4')).toBe(false);
  });

  test('builds yt-dlp args that write to the requested output template', () => {
    expect(buildYtDlpArgs('https://www.youtube.com/watch?v=test', '/work/job/source.%(ext)s')).toEqual([
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--force-overwrites',
      '--js-runtimes',
      'node',
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format',
      'mp4',
      '-o',
      '/work/job/source.%(ext)s',
      'https://www.youtube.com/watch?v=test'
    ]);
  });

  test('passes an explicit cookies file when configured', () => {
    expect(buildYtDlpArgs('https://www.youtube.com/watch?v=test', '/work/job/source.%(ext)s', {
      cookiesPath: '/data/app/youtube-cookies.txt'
    })).toEqual([
      '--cookies',
      '/data/app/youtube-cookies.txt',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--force-overwrites',
      '--js-runtimes',
      'node',
      '-f',
      'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format',
      'mp4',
      '-o',
      '/work/job/source.%(ext)s',
      'https://www.youtube.com/watch?v=test'
    ]);
  });

  test('keeps a single yt-dlp media transfer determinate', () => {
    const tracker = createYtDlpProgressTracker();

    expect(tracker.push('[download]  12.5% of 10.00MiB at 1.00MiB/s ETA 00:08\n')).toEqual([
      { fraction: 0.125, kind: 'progress', label: 'Downloading media' }
    ]);
    expect(tracker.push('[download] 100.0% of 10.00MiB at 1.00MiB/s ETA 00:00\n')).toEqual([
      { fraction: 0.99, kind: 'progress', label: 'Downloading media' }
    ]);
  });

  test('switches to honest indeterminate activity when yt-dlp starts another media stream', () => {
    const tracker = createYtDlpProgressTracker();

    tracker.push('[download] 100.0% of 10.00MiB at 1.00MiB/s ETA 00:00\n');

    expect(tracker.push('[download]   4.0% of 2.00MiB at 1.00MiB/s ETA 00:02\n')).toEqual([
      { kind: 'activity', label: 'Downloading additional media stream' }
    ]);
    expect(tracker.push('[download]  80.0% of 2.00MiB at 1.00MiB/s ETA 00:01\n')).toEqual([
      { kind: 'activity', label: 'Downloading additional media stream' }
    ]);
    expect(tracker.push('[Merger] Merging formats into "source.mp4"\n')).toEqual([
      { kind: 'activity', label: 'Merging media streams' }
    ]);
  });

  test('buffers split yt-dlp output lines before parsing progress', () => {
    const tracker = createYtDlpProgressTracker();

    expect(tracker.push('[download]  42.')).toEqual([]);
    expect(tracker.push('0% of 10.00MiB\n')).toEqual([
      { fraction: 0.42, kind: 'progress', label: 'Downloading media' }
    ]);
  });
});

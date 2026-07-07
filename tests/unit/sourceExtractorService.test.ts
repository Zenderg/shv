import { describe, expect, test } from 'vitest';
import { buildYtDlpArgs, isYouTubeUrl, YtDlpSourceExtractor } from '../../src/server/source-extractors/sourceExtractorService.js';

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
});

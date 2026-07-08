import { describe, expect, test } from 'vitest';
import {
  buildBurnSubtitleArgs,
  buildTranscodeArgs,
  hasSuspiciousDurationInflation,
  hasTimestampWarnings,
  latestFfmpegTime,
  moveFile,
  shouldRemuxToBrowserFriendlyMp4,
  videoDisplayDimensions
} from '../../src/server/media-processing/mediaProcessor.js';

describe('buildBurnSubtitleArgs', () => {
  test('burns one selected subtitle track into the video image', () => {
    const args = buildBurnSubtitleArgs('/library/video.mp4', '/work/video-with-subs.mp4', {
      contentType: 'text/x-ssa',
      format: 'ass',
      isDefault: false,
      isSelected: true,
      label: 'Russian',
      language: 'ru',
      source: 'network',
      url: 'https://media.example.test/subtitles/ru.ass',
      localPath: '/work/subtitles/ru.ass'
    });

    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      '/library/video.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-vf',
      "subtitles=filename='/work/subtitles/ru.ass'",
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '-preset',
      'veryfast',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      '/work/video-with-subs.mp4'
    ]);
  });
});

describe('buildTranscodeArgs', () => {
  test('preserves input timestamps before decoding timestamp-inflated HLS sources', () => {
    const args = buildTranscodeArgs('/work/source', '/library/video.mp4', { preserveInputTimestamps: true });

    expect(args.slice(0, 6)).toEqual(['-hide_banner', '-y', '-copyts', '-start_at_zero', '-i', '/work/source']);
    expect(args).toContain('/library/video.mp4');
  });

  test('uses ordinary timestamp normalization by default', () => {
    const args = buildTranscodeArgs('/work/source', '/library/video.mp4');

    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-y', '-i', '/work/source']);
    expect(args).not.toContain('-copyts');
    expect(args).not.toContain('-start_at_zero');
  });
});

describe('moveFile', () => {
  test('falls back to copy and remove when rename crosses Docker volumes', () => {
    const calls: string[] = [];
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    const fileSystem = {
      renameSync: () => {
        calls.push('rename');
        throw exdev;
      },
      copyFileSync: () => {
        calls.push('copy');
      },
      rmSync: () => {
        calls.push('remove');
      }
    };

    moveFile('/work/source', '/data/library/video.mp4', fileSystem);

    expect(calls).toEqual(['rename', 'copy', 'remove']);
  });

  test('rethrows rename failures that are not cross-device moves', () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const fileSystem = {
      renameSync: () => {
        throw failure;
      },
      copyFileSync: () => {
        throw new Error('copy should not be called');
      },
      rmSync: () => {
        throw new Error('remove should not be called');
      }
    };

    expect(() => moveFile('/work/source', '/data/library/video.mp4', fileSystem)).toThrow(failure);
  });
});

describe('latestFfmpegTime', () => {
  test('reads ffmpeg progress output', () => {
    const output = [
      'frame=120',
      'out_time_us=1250000',
      'out_time=00:00:01.250000',
      'progress=continue',
      'frame=360',
      'out_time_us=3750000',
      'out_time=00:00:03.750000',
      'progress=continue'
    ].join('\n');

    expect(latestFfmpegTime(output)).toBe(3.75);
  });

  test('reads ffmpeg out_time_ms progress values', () => {
    expect(latestFfmpegTime('frame=360\nout_time_ms=3750000\nprogress=continue')).toBe(3.75);
  });
});

describe('videoDisplayDimensions', () => {
  test('uses the encoded dimensions when no display rotation is present', () => {
    expect(videoDisplayDimensions({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  });

  test('swaps dimensions for quarter-turn display rotation metadata', () => {
    expect(videoDisplayDimensions({ width: 1920, height: 1080, side_data_list: [{ rotation: 90 }] })).toEqual({
      width: 1080,
      height: 1920
    });
  });
});

describe('shouldRemuxToBrowserFriendlyMp4', () => {
  test('remuxes browser-compatible codecs from non-MP4 containers', () => {
    expect(
      shouldRemuxToBrowserFriendlyMp4({
        durationSeconds: 1049.803,
        width: 1920,
        height: 1080,
        sizeBytes: 202257552,
        container: 'matroska,webm',
        videoCodec: 'vp9',
        audioCodec: null,
        browserFriendly: false
      })
    ).toBe(true);
  });

  test('does not remux files that are already browser-friendly MP4', () => {
    expect(
      shouldRemuxToBrowserFriendlyMp4({
        durationSeconds: 1049.803,
        width: 1920,
        height: 1080,
        sizeBytes: 202257552,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        videoCodec: 'vp9',
        audioCodec: null,
        browserFriendly: true
      })
    ).toBe(false);
  });

  test('does not remux unsupported video codecs', () => {
    expect(
      shouldRemuxToBrowserFriendlyMp4({
        durationSeconds: 1049.803,
        width: 1920,
        height: 1080,
        sizeBytes: 202257552,
        container: 'avi',
        videoCodec: 'mpeg4',
        audioCodec: 'mp3',
        browserFriendly: false
      })
    ).toBe(false);
  });
});

describe('hasSuspiciousDurationInflation', () => {
  test('flags remux outputs that grow far beyond the input duration', () => {
    expect(hasSuspiciousDurationInflation(651.960589, 692.261)).toBe(true);
  });

  test('allows small container duration differences after remuxing', () => {
    expect(hasSuspiciousDurationInflation(651.960589, 651.980589)).toBe(false);
  });

  test('ignores unknown durations', () => {
    expect(hasSuspiciousDurationInflation(null, 692.261)).toBe(false);
    expect(hasSuspiciousDurationInflation(651.960589, null)).toBe(false);
  });
});

describe('hasTimestampWarnings', () => {
  test('flags non-monotonic timestamp warnings', () => {
    expect(hasTimestampWarnings('Application provided invalid, non monotonically increasing dts to muxer in stream 0')).toBe(true);
  });

  test('allows ordinary ffmpeg output', () => {
    expect(hasTimestampWarnings('frame=10 fps=0.0 size=1kB time=00:00:01.0')).toBe(false);
  });
});

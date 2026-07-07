import { describe, expect, test } from 'vitest';
import { latestFfmpegTime, moveFile, shouldRemuxToBrowserFriendlyMp4, videoDisplayDimensions } from '../../src/server/media-processing/mediaProcessor.js';

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

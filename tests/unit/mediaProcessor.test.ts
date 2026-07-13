import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import type { TaskProgressUpdate } from '../../src/server/utils/taskProgress.js';
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
      '-nostats',
      '-progress',
      'pipe:2',
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
  test('uses rename without opening copy streams on the fast path', async () => {
    const calls: string[] = [];
    const updates: TaskProgressUpdate[] = [];
    const fileSystem = {
      createReadStream: () => {
        throw new Error('copy input should not be opened');
      },
      createWriteStream: () => {
        throw new Error('copy output should not be opened');
      },
      rename: async () => {
        calls.push('rename');
      },
      rm: async () => {
        throw new Error('source should not be removed separately');
      },
      stat: async () => {
        throw new Error('source should not be statted');
      }
    };

    await moveFile('/work/source', '/data/library/video.mp4', (update) => updates.push(update), undefined, fileSystem);

    expect(calls).toEqual(['rename']);
    expect(updates).toEqual([
      { kind: 'activity', label: 'Moving video' },
      { fraction: 1, kind: 'progress', label: 'Moving video' }
    ]);
  });

  test('streams cross-volume copies with byte progress before removing the source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-move-file-'));
    const inputPath = path.join(root, 'source.mp4');
    const outputPath = path.join(root, 'library.mp4');
    const content = Buffer.alloc(192 * 1024, 7);
    fs.writeFileSync(inputPath, content);
    fs.writeFileSync(outputPath, 'stale output');
    const updates: TaskProgressUpdate[] = [];
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });

    await moveFile(inputPath, outputPath, (update) => updates.push(update), undefined, {
      createReadStream: (filePath) => fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }),
      createWriteStream: (filePath) => fs.createWriteStream(filePath, { flags: 'w' }),
      rename: async () => {
        throw exdev;
      },
      rm: (filePath, options) => fs.promises.rm(filePath, options),
      stat: (filePath) => fs.promises.stat(filePath)
    });

    expect(fs.existsSync(inputPath)).toBe(false);
    expect(fs.readFileSync(outputPath)).toEqual(content);
    expect(updates).toContainEqual({ fraction: 0.99, kind: 'progress', label: 'Moving video' });
    expect(updates.at(-1)).toEqual({ fraction: 1, kind: 'progress', label: 'Moving video' });
    expect(updates.some((update) => update.kind === 'progress' && update.fraction > 0 && update.fraction < 0.99)).toBe(true);
  });

  test('aborts a cross-volume copy, removes the partial output, and keeps the source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-move-file-abort-'));
    const inputPath = path.join(root, 'source.mp4');
    const outputPath = path.join(root, 'library.mp4');
    fs.writeFileSync(inputPath, 'original source');
    const controller = new AbortController();
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    let copyProgressUpdates = 0;

    await expect(moveFile(inputPath, outputPath, (update) => {
      if (update.kind === 'progress' && update.fraction < 1) {
        copyProgressUpdates += 1;
        controller.abort();
      }
    }, controller.signal, {
      createReadStream: () => Readable.from([Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024)]),
      createWriteStream: (filePath) => fs.createWriteStream(filePath, { flags: 'w' }),
      rename: async () => {
        throw exdev;
      },
      rm: (filePath, options) => fs.promises.rm(filePath, options),
      stat: async () => ({ size: 128 * 1024 })
    })).rejects.toMatchObject({ name: 'JobCanceledError' });

    expect(copyProgressUpdates).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(inputPath)).toBe(true);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  test('surfaces both the copy and partial-output cleanup failures', async () => {
    const exdev = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    const copyFailure = new Error('copy failed');
    const cleanupFailure = new Error('cleanup failed');
    const copyResult = await moveFile('/work/source', '/data/library/video.mp4', () => undefined, undefined, {
      createReadStream: () => Readable.from((async function* () {
        yield Buffer.from('partial');
        throw copyFailure;
      })()),
      createWriteStream: () => new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        }
      }),
      rename: async () => {
        throw exdev;
      },
      rm: async (filePath) => {
        if (filePath === '/data/library/video.mp4') {
          throw cleanupFailure;
        }
      },
      stat: async () => ({ size: 14 })
    }).then(
      () => null,
      (error: unknown) => error
    );

    expect(copyResult).toBeInstanceOf(AggregateError);
    expect((copyResult as AggregateError).errors).toEqual([copyFailure, cleanupFailure]);
  });

  test('rethrows rename failures that are not cross-device moves', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const fileSystem = {
      createReadStream: () => {
        throw new Error('copy should not start');
      },
      createWriteStream: () => {
        throw new Error('copy should not start');
      },
      rename: async () => {
        throw failure;
      },
      rm: async () => {
        throw new Error('cleanup should not be called');
      },
      stat: async () => {
        throw new Error('stat should not be called');
      }
    };

    await expect(moveFile('/work/source', '/data/library/video.mp4', () => undefined, undefined, fileSystem)).rejects.toBe(failure);
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

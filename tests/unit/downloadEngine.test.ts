import { describe, expect, test } from 'vitest';
import { buildDashFfmpegArgs, buildHlsFfmpegArgs, formatFfmpegError } from '../../src/server/download-engine/downloadEngine.js';
import type { DashRepresentation } from '../../src/server/download-engine/dash.js';

describe('DownloadEngine ffmpeg helpers', () => {
  const video: DashRepresentation = {
    id: 'video',
    bandwidth: 4_200_000,
    width: 1920,
    height: 1080,
    baseUrl: 'https://media.example.test/video.webm'
  };

  const audio: DashRepresentation = {
    id: 'audio',
    bandwidth: 128_000,
    width: null,
    height: null,
    baseUrl: 'https://media.example.test/audio.webm'
  };

  test('maps separate DASH video and audio inputs into one output', () => {
    const args = buildDashFfmpegArgs(video, audio, { Referer: 'https://example.test/' }, '/work/source');

    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-f', 'matroska', '/work/source']));
    expect(args.filter((arg) => arg === '-i')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(['https://media.example.test/video.webm', 'https://media.example.test/audio.webm']));
    expect(args).toEqual(expect.arrayContaining(['-reconnect', '1', '-reconnect_on_network_error', '1']));
  });

  test('builds HLS ffmpeg args with reconnects but no EOF reconnects or persistent segment connections', () => {
    const args = buildHlsFfmpegArgs(
      'https://media.example.test/playlist.m3u8',
      { Referer: 'https://source.example.test/' },
      '/work/job/source'
    );

    expect(args).toEqual(
      expect.arrayContaining([
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-http_persistent',
        '0',
        '-fflags',
        '+discardcorrupt'
      ])
    );
    expect(args.indexOf('-http_persistent')).toBeLessThan(args.indexOf('-i'));
    expect(args).not.toContain('-reconnect_at_eof');
  });

  test('formats ffmpeg HLS network errors without frame spam or signed query strings', () => {
    const error = formatFfmpegError(
      1,
      [
        'frame= 4120 fps= 19 size=   61952kB time=00:02:44.76 bitrate=3080.3kbits/s speed=0.755x',
        "[https @ 0xaaa] Opening 'https://media.example.test/seg-43.ts?token=secret' for reading",
        '[tls @ 0xaaa] IO error: End of file',
        '[https @ 0xbbb] Stream ends prematurely at 1221185, should be 1224632',
        '[mpegts @ 0xccc] Packet corrupt (stream = 1, dts = 15293857).',
        'Conversion failed!'
      ].join('\n')
    );

    expect(error).toContain('HLS segment download failed');
    expect(error).toContain('https://media.example.test/seg-43.ts?<redacted>');
    expect(error).toContain('Stream ends prematurely');
    expect(error).not.toContain('frame= 4120');
    expect(error).not.toContain('token=secret');
  });
});

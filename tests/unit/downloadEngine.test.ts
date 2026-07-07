import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DownloadEngine,
  buildDashFfmpegArgs,
  buildHlsFfmpegArgs,
  formatFfmpegError,
  type BrowserRequestDownloadInput
} from '../../src/server/download-engine/downloadEngine.js';
import type { MediaCandidate } from '../../src/shared/types.js';
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

  test('uses the browser-impersonated downloader directly for browser-request media', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-browser-request-'));
    const outputPath = path.join(tempDir, 'source');
    const calls: BrowserRequestDownloadInput[] = [];
    const engine = new DownloadEngine(async (input) => {
      calls.push(input);
      fs.writeFileSync(input.outputPath, 'browser bytes');
      input.onProgress(0.5);
      return { bytesWritten: fs.statSync(input.outputPath).size, filePath: input.outputPath };
    });
    const candidate: MediaCandidate = {
      bitrate: null,
      confidence: 0.86,
      contentType: 'video/mp4',
      discoveredAt: new Date().toISOString(),
      durationSeconds: null,
      headers: {
        Cookie: 'csrftoken=value',
        Referer: 'https://source.example.test/player',
        'User-Agent': 'Mozilla/5.0 test'
      },
      id: 'candidate-id',
      jobId: 'job-id',
      kind: 'browser-request',
      manifestType: null,
      resolution: null,
      sizeBytes: 1200,
      url: 'https://media.example.test/video.mp4'
    };
    const progress: number[] = [];

    const result = await engine.download(candidate, outputPath, (value) => progress.push(value));

    expect(result.bytesWritten).toBe('browser bytes'.length);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      outputPath,
      url: candidate.url
    });
    expect(calls[0].headers).toMatchObject({
      Cookie: 'csrftoken=value',
      Range: 'bytes=0-',
      Referer: 'https://source.example.test/player',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      'User-Agent': 'Mozilla/5.0 test'
    });
    expect(progress).toContain(0.5);
  });
});

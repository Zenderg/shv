import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import type { MediaCandidate } from '../../src/shared/types.js';
import { DownloadEngine } from '../../src/server/download-engine/downloadEngine.js';

describe('DownloadEngine direct download', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  test('downloads a direct video response from a local fixture server', async () => {
    const content = Buffer.from('fixture-video-bytes');
    const server = http.createServer((request, response) => {
      response.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': content.length
      });
      response.end(content);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not expose a port');
    }

    const candidate: MediaCandidate = {
      id: 'candidate',
      jobId: 'job',
      kind: 'direct',
      url: `http://127.0.0.1:${address.port}/video.mp4`,
      contentType: 'video/mp4',
      manifestType: null,
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: content.length,
      confidence: 1,
      headers: {},
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-download-')), 'video.mp4');

    const result = await new DownloadEngine().download(candidate, output, () => undefined);

    expect(result.bytesWritten).toBe(content.length);
    expect(fs.readFileSync(output)).toEqual(content);
  });

  test('downloads plain HLS media segments without requiring ffmpeg demuxing', async () => {
    const firstSegment = Buffer.from('first-ts-segment');
    const secondSegment = Buffer.from('second-ts-segment');
    const server = http.createServer((request, response) => {
      switch (request.url) {
        case '/master.m3u8':
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360', 'media.m3u8', ''].join('\n'));
          return;
        case '/media.m3u8':
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end([
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:4',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-MEDIA-SEQUENCE:1',
            '#EXTINF:4.0,',
            'seg-1.ts',
            '#EXTINF:3.0,',
            'seg-2.ts',
            '#EXT-X-ENDLIST',
            ''
          ].join('\n'));
          return;
        case '/seg-1.ts':
          response.writeHead(200, { 'content-type': 'video/MP2T', 'content-length': firstSegment.length });
          response.end(firstSegment);
          return;
        case '/seg-2.ts':
          response.writeHead(200, { 'content-type': 'video/MP2T', 'content-length': secondSegment.length });
          response.end(secondSegment);
          return;
        default:
          response.writeHead(404).end();
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not expose a port');
    }

    const candidate: MediaCandidate = {
      id: 'candidate',
      jobId: 'job',
      kind: 'hls',
      url: `http://127.0.0.1:${address.port}/master.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
      manifestType: 'hls',
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: null,
      confidence: 1,
      headers: {},
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-download-')), 'video.ts');
    const progress: number[] = [];

    const result = await new DownloadEngine().download(candidate, output, (value) => progress.push(value));

    expect(result.bytesWritten).toBe(firstSegment.length + secondSegment.length);
    expect(fs.readFileSync(output)).toEqual(Buffer.concat([firstSegment, secondSegment]));
    expect(progress.at(-1)).toBe(0.95);
  });

  test('normalizes timestamps while stitching downloaded HLS segments', async () => {
    const segmentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-segments-'));
    const firstSegmentPath = path.join(segmentDirectory, 'seg-1.ts');
    const secondSegmentPath = path.join(segmentDirectory, 'seg-2.ts');
    await createTestSegment(firstSegmentPath, 1000);
    await createTestSegment(secondSegmentPath, 1200, 10);
    const firstSegment = fs.readFileSync(firstSegmentPath);
    const secondSegment = fs.readFileSync(secondSegmentPath);
    const server = http.createServer((request, response) => {
      switch (request.url) {
        case '/master.m3u8':
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360', 'media.m3u8', ''].join('\n'));
          return;
        case '/media.m3u8':
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end([
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:1',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-MEDIA-SEQUENCE:1',
            '#EXTINF:1.0,',
            'seg-1.ts',
            '#EXTINF:1.0,',
            'seg-2.ts',
            '#EXT-X-ENDLIST',
            ''
          ].join('\n'));
          return;
        case '/seg-1.ts':
          response.writeHead(200, { 'content-type': 'video/MP2T', 'content-length': firstSegment.length });
          response.end(firstSegment);
          return;
        case '/seg-2.ts':
          response.writeHead(200, { 'content-type': 'video/MP2T', 'content-length': secondSegment.length });
          response.end(secondSegment);
          return;
        default:
          response.writeHead(404).end();
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server did not expose a port');
    }

    const candidate: MediaCandidate = {
      id: 'candidate',
      jobId: 'job',
      kind: 'hls',
      url: `http://127.0.0.1:${address.port}/master.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
      manifestType: 'hls',
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: null,
      confidence: 1,
      headers: {},
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-download-')), 'video.ts');

    await new DownloadEngine().download(candidate, output, () => undefined);

    await expect(probeDuration(output)).resolves.toBeCloseTo(2, 0);
  });
});

async function createTestSegment(filePath: string, audioFrequency: number, timestampOffsetSeconds = 0): Promise<void> {
  const args = [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=25',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${audioFrequency}:sample_rate=44100`,
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac'
  ];
  if (timestampOffsetSeconds > 0) {
    args.push('-output_ts_offset', String(timestampOffsetSeconds));
  }
  args.push('-f', 'mpegts', filePath);
  await run(args);
}

async function probeDuration(filePath: string): Promise<number> {
  const output = await run(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], 'ffprobe');
  return Number(output.trim());
}

async function run(args: string[], command = 'ffmpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
    });
  });
}

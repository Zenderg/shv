import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import type { MediaCandidate } from '../../src/shared/types.js';
import { DownloadEngine, buildHlsFfmpegArgs } from '../../src/server/download-engine/downloadEngine.js';
import type { TaskProgressUpdate } from '../../src/server/utils/taskProgress.js';
import {
  MediaSession,
  type MediaHttpProxyOptions,
  type MediaSessionLike
} from '../../src/server/utils/mediaHttpProxy.js';

const testSessionFactory = async (): Promise<MediaSessionLike> => ({
  proxyUrl: 'http://127.0.0.1:1',
  close: async () => undefined,
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit) as never
});

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
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-download-')), 'video.mp4');

    const result = await new DownloadEngine().download(candidate, output, () => undefined);

    expect(result.bytesWritten).toBe(content.length);
    expect(fs.readFileSync(output)).toEqual(content);
  });

  test('reports activity and completes when a direct response has no total size', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.write('first');
      setTimeout(() => response.end('second'), 15);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not expose a port');

    const candidate: MediaCandidate = {
      id: 'candidate', jobId: 'job', kind: 'direct', url: `http://127.0.0.1:${address.port}/video.mp4`,
      contentType: 'video/mp4', manifestType: null, resolution: null, bitrate: null, durationSeconds: null,
      sizeBytes: null, confidence: 1, headers: {}, subtitleTracks: [], discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-unknown-total-')), 'video.mp4');
    const updates: TaskProgressUpdate[] = [];

    await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, (update) => updates.push(update));

    expect(updates).toContainEqual({ kind: 'activity' });
    expect(updates.at(-1)).toEqual({ kind: 'progress', fraction: 1 });
  });

  test('restarts a direct download when a partial response starts at the wrong offset', async () => {
    const content = Buffer.from('complete-fixture-video');
    const partial = Buffer.from('corrupt-partial');
    const ranges: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      ranges.push(request.headers.range);
      if (ranges.length === 1) {
        response.writeHead(206, {
          'content-length': partial.length,
          'content-range': `bytes 0-${partial.length - 1}/${content.length}`
        });
        response.end(partial);
        return;
      }
      response.writeHead(200, {
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
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-resume-download-')), 'video.mp4');
    fs.writeFileSync(output, 'stale');

    const result = await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, () => undefined);

    expect(ranges).toEqual(['bytes=5-', undefined]);
    expect(result.bytesWritten).toBe(content.length);
    expect(fs.readFileSync(output)).toEqual(content);
  });

  test('rejects a partial response returned after a resume retry', async () => {
    const existing = Buffer.from('stale');
    const ranges: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      ranges.push(request.headers.range);
      response.writeHead(206, {
        'content-length': 3,
        'content-range': 'bytes 0-2/10'
      });
      response.end('bad');
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
      sizeBytes: 10,
      confidence: 1,
      headers: {},
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-resume-download-')), 'video.mp4');
    fs.writeFileSync(output, existing);

    await expect(new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, () => undefined)).rejects.toThrow(
      'Download resume retry returned HTTP 206; expected a complete HTTP 200 response'
    );
    expect(ranges).toEqual([`bytes=${existing.length}-`, undefined]);
    expect(fs.readFileSync(output)).toEqual(existing);
  });

  test('appends a direct download only when the partial response starts at the requested offset', async () => {
    const existing = Buffer.from('stale');
    const remaining = Buffer.from('-remaining-video');
    const server = http.createServer((request, response) => {
      expect(request.headers.range).toBe(`bytes=${existing.length}-`);
      response.writeHead(206, {
        'content-length': remaining.length,
        'content-range': `bytes ${existing.length}-${existing.length + remaining.length - 1}/${existing.length + remaining.length}`
      });
      response.end(remaining);
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
      sizeBytes: existing.length + remaining.length,
      confidence: 1,
      headers: {},
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-resume-download-')), 'video.mp4');
    fs.writeFileSync(output, existing);

    const result = await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, () => undefined);

    expect(result.bytesWritten).toBe(existing.length + remaining.length);
    expect(fs.readFileSync(output)).toEqual(Buffer.concat([existing, remaining]));
  });

  test('does not count resumed bytes twice when only the candidate total is known', async () => {
    const existing = Buffer.from('12345');
    const remaining = Buffer.from('67890');
    const server = http.createServer((request, response) => {
      expect(request.headers.range).toBe(`bytes=${existing.length}-`);
      response.writeHead(206, { 'content-range': `bytes ${existing.length}-9/*` });
      response.end(remaining);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not expose a port');

    const candidate: MediaCandidate = {
      id: 'candidate', jobId: 'job', kind: 'direct', url: `http://127.0.0.1:${address.port}/video.mp4`,
      contentType: 'video/mp4', manifestType: null, resolution: null, bitrate: null, durationSeconds: null,
      sizeBytes: 10, confidence: 1, headers: {}, subtitleTracks: [], discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-resume-total-')), 'video.mp4');
    fs.writeFileSync(output, existing);
    const updates: TaskProgressUpdate[] = [];

    await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, (update) => updates.push(update));

    expect(updates).toContainEqual({ kind: 'progress', fraction: 0.99 });
    expect(fs.readFileSync(output)).toEqual(Buffer.concat([existing, remaining]));
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
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-download-')), 'video.ts');
    const progress: TaskProgressUpdate[] = [];

    const result = await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, (value) => progress.push(value));

    expect(result.bytesWritten).toBe(firstSegment.length + secondSegment.length);
    expect(fs.readFileSync(output)).toEqual(Buffer.concat([firstSegment, secondSegment]));
    expect(progress.at(-1)).toEqual({ kind: 'progress', fraction: 1 });
  });

  test('does not replay captured headers to cross-origin HLS variants or segments', async () => {
    const crossOriginHeaders: Array<{ authorization?: string; cookie?: string; custom?: string }> = [];
    const mediaServer = http.createServer((request, response) => {
      crossOriginHeaders.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        custom: request.headers['x-media-token'] as string | undefined
      });
      if (request.url === '/media.m3u8') {
        response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
        response.end(['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4,', 'seg-1.ts', '#EXT-X-ENDLIST', ''].join('\n'));
        return;
      }
      if (request.url === '/seg-1.ts') {
        response.writeHead(200, { 'content-type': 'video/MP2T' });
        response.end('segment-bytes');
        return;
      }
      response.writeHead(404).end();
    });
    servers.push(mediaServer);
    await new Promise<void>((resolve) => mediaServer.listen(0, '127.0.0.1', resolve));
    const mediaAddress = mediaServer.address();
    if (!mediaAddress || typeof mediaAddress === 'string') {
      throw new Error('Media server did not expose a port');
    }

    const manifestHeaders: Array<{ authorization?: string; cookie?: string; custom?: string }> = [];
    const manifestServer = http.createServer((request, response) => {
      manifestHeaders.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        custom: request.headers['x-media-token'] as string | undefined
      });
      response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      response.end([
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360',
        `http://127.0.0.1:${mediaAddress.port}/media.m3u8`,
        ''
      ].join('\n'));
    });
    servers.push(manifestServer);
    await new Promise<void>((resolve) => manifestServer.listen(0, '127.0.0.1', resolve));
    const manifestAddress = manifestServer.address();
    if (!manifestAddress || typeof manifestAddress === 'string') {
      throw new Error('Manifest server did not expose a port');
    }

    const candidate: MediaCandidate = {
      id: 'candidate',
      jobId: 'job',
      kind: 'hls',
      url: `http://127.0.0.1:${manifestAddress.port}/master.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
      manifestType: 'hls',
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: null,
      confidence: 1,
      headers: {
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'X-Media-Token': 'custom-secret'
      },
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-cross-origin-hls-')), 'video.ts');

    await new DownloadEngine(undefined, async (url) => url, testSessionFactory).download(candidate, output, () => undefined);

    expect(manifestHeaders).toEqual([
      { authorization: 'Bearer secret', cookie: 'session=secret', custom: 'custom-secret' }
    ]);
    expect(crossOriginHeaders).toEqual([
      { authorization: undefined, cookie: undefined, custom: undefined },
      { authorization: undefined, cookie: undefined, custom: undefined }
    ]);
  });

  test('blocks cross-origin DASH redirects before ffmpeg can replay captured credentials', async () => {
    const redirectedHeaders: Array<{ authorization?: string; cookie?: string }> = [];
    const redirectedServer = http.createServer((request, response) => {
      redirectedHeaders.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie
      });
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.end('redirected-video');
    });
    servers.push(redirectedServer);
    await new Promise<void>((resolve) => redirectedServer.listen(0, '127.0.0.1', resolve));
    const redirectedAddress = redirectedServer.address();
    if (!redirectedAddress || typeof redirectedAddress === 'string') {
      throw new Error('Redirect target server did not expose a port');
    }

    const sourceHeaders: Array<{ authorization?: string; cookie?: string }> = [];
    const sourceServer = http.createServer((request, response) => {
      if (request.url === '/manifest.mpd') {
        response.writeHead(200, { 'content-type': 'application/dash+xml' });
        response.end([
          '<MPD><Period><AdaptationSet mimeType="video/mp4">',
          '<Representation bandwidth="1"><BaseURL>video.mp4</BaseURL></Representation>',
          '</AdaptationSet></Period></MPD>'
        ].join(''));
        return;
      }
      if (request.url === '/video.mp4') {
        sourceHeaders.push({
          authorization: request.headers.authorization,
          cookie: request.headers.cookie
        });
        response.writeHead(302, {
          location: `http://cdn.example.test:${redirectedAddress.port}/video.mp4`
        });
        response.end();
        return;
      }
      response.writeHead(404).end();
    });
    servers.push(sourceServer);
    await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
    const sourceAddress = sourceServer.address();
    if (!sourceAddress || typeof sourceAddress === 'string') {
      throw new Error('DASH source server did not expose a port');
    }

    const candidate: MediaCandidate = {
      id: 'candidate',
      jobId: 'job',
      kind: 'dash',
      url: `http://media.example.test:${sourceAddress.port}/manifest.mpd`,
      contentType: 'application/dash+xml',
      manifestType: 'dash',
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: null,
      confidence: 1,
      headers: {
        Authorization: 'Bearer dash-secret',
        Cookie: 'session=dash-secret'
      },
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-cross-origin-dash-')), 'video.mkv');
    const proxySessionFactory = (options: MediaHttpProxyOptions = {}) => MediaSession.start({
      ...options,
      connect: (_address, port) => net.connect({ host: '127.0.0.1', port }),
      resolve: async () => [{ address: '93.184.216.34', family: 4 }]
    });

    await expect(
      new DownloadEngine(undefined, undefined, proxySessionFactory).download(candidate, output, () => undefined)
    ).rejects.toThrow();

    expect(sourceHeaders).toEqual([{
      authorization: 'Bearer dash-secret',
      cookie: 'session=dash-secret'
    }]);
    expect(redirectedHeaders).toEqual([]);
  });

  test('allows ffmpeg HTTPS inputs to reach the configured HTTP proxy', async () => {
    let connectTarget: string | undefined;
    const proxy = http.createServer();
    proxy.on('connect', (request, socket) => {
      connectTarget = request.url;
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    servers.push(proxy);
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test HTTP proxy did not expose a port');
    }

    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-https-proxy-')), 'video.mkv');
    const args = buildHlsFfmpegArgs(
      'https://media.shv-proxy-regression.invalid/playlist.m3u8',
      output,
      `http://127.0.0.1:${address.port}`
    );

    await expect(run(['-hide_banner', ...args])).rejects.toThrow(/ffmpeg exited with code/);

    expect(connectTarget).toBe('media.shv-proxy-regression.invalid:443');
  });

  test('normalizes timestamps while stitching downloaded HLS segments', async () => {
    const segmentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-segments-'));
    const firstSegmentPath = path.join(segmentDirectory, 'seg-1.ts');
    const secondSegmentPath = path.join(segmentDirectory, 'seg-2.ts');
    await createTestSegment(firstSegmentPath, 1000);
    await createTestSegment(secondSegmentPath, 1200, 10);
    const firstSegment = fs.readFileSync(firstSegmentPath);
    const secondSegment = fs.readFileSync(secondSegmentPath);
    let forceFfmpegNetworkPath = false;
    let mediaManifestRequestCount = 0;
    const observedRequests: Array<{
      authorization?: string;
      cookie?: string;
      custom?: string;
      host?: string;
      path?: string;
    }> = [];
    const server = http.createServer((request, response) => {
      observedRequests.push({
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        custom: request.headers['x-media-token'] as string | undefined,
        host: request.headers.host,
        path: request.url
      });
      switch (request.url) {
        case '/master.m3u8':
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360', 'media.m3u8', ''].join('\n'));
          return;
        case '/media.m3u8':
          mediaManifestRequestCount += 1;
          const extension = forceFfmpegNetworkPath ? 'm4s' : 'ts';
          const segmentOrigin = forceFfmpegNetworkPath && mediaManifestRequestCount >= 3
            ? `http://cdn.example.test:${(server.address() as net.AddressInfo).port}/`
            : '';
          response.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
          response.end([
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:1',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-MEDIA-SEQUENCE:1',
            '#EXTINF:1.0,',
            `${segmentOrigin}seg-1.${extension}`,
            '#EXTINF:1.0,',
            `${segmentOrigin}seg-2.${extension}`,
            '#EXT-X-ENDLIST',
            ''
          ].join('\n'));
          return;
        case '/seg-1.ts':
        case '/seg-1.m4s':
          response.writeHead(200, { 'content-type': 'video/MP2T', 'content-length': firstSegment.length });
          response.end(firstSegment);
          return;
        case '/seg-2.ts':
        case '/seg-2.m4s':
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
      url: `http://media.example.test:${address.port}/master.m3u8`,
      contentType: 'application/vnd.apple.mpegurl',
      manifestType: 'hls',
      resolution: null,
      bitrate: null,
      durationSeconds: null,
      sizeBytes: null,
      confidence: 1,
      headers: {
        Authorization: 'Bearer manifest-secret',
        Cookie: 'session=manifest-secret',
        'X-Media-Token': 'custom-manifest-secret'
      },
      subtitleTracks: [],
      discoveredAt: new Date().toISOString()
    };
    const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-hls-download-')), 'video.ts');

    const proxySessionFactory = (options: MediaHttpProxyOptions = {}) => MediaSession.start({
      ...options,
      connect: (_address, port) => net.connect({ host: '127.0.0.1', port }),
      resolve: async () => [{ address: '93.184.216.34', family: 4 }]
    });
    await new DownloadEngine(undefined, undefined, proxySessionFactory).download(candidate, output, () => undefined);

    await expect(probeDuration(output)).resolves.toBeCloseTo(2, 0);

    forceFfmpegNetworkPath = true;
    const ffmpegOutput = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shv-hls-proxy-')), 'video.mkv');
    await new DownloadEngine(undefined, undefined, proxySessionFactory).download(candidate, ffmpegOutput, () => undefined);
    await expect(probeDuration(ffmpegOutput)).resolves.toBeCloseTo(11, 0);

    const ffmpegManifestRequest = observedRequests.filter((request) => request.path === '/media.m3u8').at(-1);
    expect(ffmpegManifestRequest).toMatchObject({ authorization: undefined, cookie: undefined, custom: undefined });
    const crossOriginSegmentRequests = observedRequests.filter((request) => request.host?.startsWith('cdn.example.test:'));
    expect(crossOriginSegmentRequests).toHaveLength(2);
    expect(crossOriginSegmentRequests.every((request) => (
      request.authorization === undefined && request.cookie === undefined && request.custom === undefined
    ))).toBe(true);
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

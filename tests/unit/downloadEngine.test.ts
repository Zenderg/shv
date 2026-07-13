import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  DownloadEngine,
  buildDashFfmpegArgs,
  buildHlsFfmpegArgs,
  formatFfmpegError,
  type BrowserRequestDownloadInput
} from '../../src/server/download-engine/downloadEngine.js';
import type { MediaCandidate } from '../../src/shared/types.js';
import type { DashRepresentation } from '../../src/server/download-engine/dash.js';
import type { PublicMediaSessionLike } from '../../src/server/utils/publicHttpProxy.js';

const unsafeTestSessionFactory = async (): Promise<PublicMediaSessionLike> => ({
  proxyUrl: 'http://127.0.0.1:1',
  close: async () => undefined,
  fetch: (url, init) => globalThis.fetch(url, init as RequestInit) as never
});

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
    const args = buildDashFfmpegArgs(
      video,
      audio,
      { Referer: 'https://example.test/' },
      '/work/source',
      'https://media.example.test/manifest.mpd',
      {
        audio: 'http://127.0.0.1:9998',
        video: 'http://127.0.0.1:9999'
      }
    );

    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-f', 'matroska', '/work/source']));
    expect(args.filter((arg) => arg === '-i')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(['https://media.example.test/video.webm', 'https://media.example.test/audio.webm']));
    expect(args).toEqual(expect.arrayContaining(['-reconnect', '1', '-reconnect_on_network_error', '1']));
    expect(args.filter((arg) => arg === '-http_proxy')).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(['http://127.0.0.1:9999', 'http://127.0.0.1:9998']));
    const videoInputIndex = args.indexOf(video.baseUrl);
    const audioInputIndex = args.indexOf(audio.baseUrl);
    expect(args[args.lastIndexOf('-http_proxy', videoInputIndex) + 1]).toBe('http://127.0.0.1:9999');
    expect(args[args.lastIndexOf('-http_proxy', audioInputIndex) + 1]).toBe('http://127.0.0.1:9998');
  });

  test('does not replay captured headers to cross-origin DASH renditions', () => {
    const sameOriginVideo = { ...video, baseUrl: 'https://source.example.test/video.webm' };
    const args = buildDashFfmpegArgs(
      sameOriginVideo,
      audio,
      { Authorization: 'Bearer secret', Cookie: 'session=secret' },
      '/work/source',
      'https://source.example.test/manifest.mpd',
      {
        audio: 'http://127.0.0.1:9998',
        video: 'http://127.0.0.1:9999'
      }
    );
    const headerValues = args.flatMap((value, index) => value === '-headers' ? [args[index + 1]] : []);

    expect(headerValues[0]).toContain('Authorization: Bearer secret');
    expect(headerValues[0]).toContain('Cookie: session=secret');
    expect(headerValues[1]).toBe('');
  });

  test('rejects DASH input without a direct media representation', () => {
    expect(() => buildDashFfmpegArgs(null, null, {}, '/work/source', 'https://source.example.test/manifest.mpd', {
      audio: null,
      video: 'http://127.0.0.1:9999'
    })).toThrow(
      'DASH manifest did not include a playable media representation'
    );
  });

  test('builds HLS ffmpeg args with reconnects but no EOF reconnects or persistent segment connections', () => {
    const args = buildHlsFfmpegArgs(
      'https://media.example.test/playlist.m3u8',
      '/work/job/source',
      'http://127.0.0.1:9999'
    );

    expect(args).toEqual(
      expect.arrayContaining([
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-protocol_whitelist',
        'http,https,tcp,tls,crypto',
        '-http_proxy',
        'http://127.0.0.1:9999',
        '-http_persistent',
        '0',
        '-fflags',
        '+discardcorrupt'
      ])
    );
    expect(args.indexOf('-http_persistent')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-headers') + 1]).toBe('');
    expect(args).not.toContain('-reconnect_at_eof');
  });

  test('rejects an unsafe ffmpeg input URL before spawning ffmpeg', () => {
    expect(() => buildHlsFfmpegArgs('file:///etc/passwd', '/work/source', 'http://127.0.0.1:9999')).toThrow(/HTTP or HTTPS/);
  });

  test('rejects private HLS and DASH URLs resolved from manifests before requesting them', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-manifest-url-safety-'));
    const candidate: MediaCandidate = {
      bitrate: null,
      confidence: 0.9,
      contentType: 'application/vnd.apple.mpegurl',
      discoveredAt: new Date().toISOString(),
      durationSeconds: null,
      headers: {},
      id: 'candidate-id',
      jobId: 'job-id',
      kind: 'hls',
      manifestType: 'hls',
      resolution: null,
      sizeBytes: null,
      subtitleTracks: [],
      url: 'https://1.1.1.1/master.m3u8'
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://127.0.0.1/private.m3u8'))
      .mockResolvedValueOnce(new Response('<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation bandwidth="1"><BaseURL>http://169.254.169.254/video.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>'));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(new DownloadEngine(undefined, undefined, unsafeTestSessionFactory).download(candidate, path.join(tempDir, 'source'), () => undefined)).rejects.toThrow(/public address/);
      await expect(new DownloadEngine(undefined, undefined, unsafeTestSessionFactory).download({ ...candidate, kind: 'dash', manifestType: 'dash' }, path.join(tempDir, 'dash-source'), () => undefined)).rejects.toThrow(
        /public address/
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('rejects HLS and DASH redirects to private targets before following them', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-manifest-redirect-safety-'));
    const candidate: MediaCandidate = {
      bitrate: null,
      confidence: 0.9,
      contentType: 'application/vnd.apple.mpegurl',
      discoveredAt: new Date().toISOString(),
      durationSeconds: null,
      headers: {},
      id: 'candidate-id',
      jobId: 'job-id',
      kind: 'hls',
      manifestType: 'hls',
      resolution: null,
      sizeBytes: null,
      subtitleTracks: [],
      url: 'https://1.1.1.1/master.m3u8'
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { location: 'http://127.0.0.1/private.m3u8' }, status: 302 }))
      .mockResolvedValueOnce(new Response(null, { headers: { location: 'http://169.254.169.254/video.mp4' }, status: 302 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(new DownloadEngine(undefined, undefined, unsafeTestSessionFactory).download(candidate, path.join(tempDir, 'hls-source'), () => undefined)).rejects.toThrow(/public address/);
      await expect(new DownloadEngine(undefined, undefined, unsafeTestSessionFactory).download({ ...candidate, kind: 'dash', manifestType: 'dash' }, path.join(tempDir, 'dash-source'), () => undefined)).rejects.toThrow(
        /public address/
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.every(([, options]) => options.redirect === 'manual')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('strips captured credentials on cross-origin redirects and keeps them on same-origin redirects', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-header-redirect-safety-'));
    const candidate: MediaCandidate = {
      bitrate: null,
      confidence: 0.9,
      contentType: 'video/mp4',
      discoveredAt: new Date().toISOString(),
      durationSeconds: null,
      headers: { Authorization: 'Bearer secret', Cookie: 'session=secret' },
      id: 'candidate-id',
      jobId: 'job-id',
      kind: 'direct',
      manifestType: null,
      resolution: null,
      sizeBytes: null,
      subtitleTracks: [],
      url: 'https://source.example.test/video.mp4'
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { location: 'https://cdn.example.test/video.mp4' }, status: 302 }))
      .mockResolvedValueOnce(new Response('cross-origin'))
      .mockResolvedValueOnce(new Response(null, { headers: { location: '/final.mp4' }, status: 302 }))
      .mockResolvedValueOnce(new Response('same-origin'));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const engine = new DownloadEngine(undefined, async (url) => url, unsafeTestSessionFactory);
      await engine.download(candidate, path.join(tempDir, 'cross-origin.mp4'), () => undefined);
      await engine.download(candidate, path.join(tempDir, 'same-origin.mp4'), () => undefined);

      expect(fetchMock.mock.calls[0][1].headers).toEqual(candidate.headers);
      expect(fetchMock.mock.calls[1][1].headers).toEqual({});
      expect(fetchMock.mock.calls[2][1].headers).toEqual(candidate.headers);
      expect(fetchMock.mock.calls[3][1].headers).toEqual(candidate.headers);
    } finally {
      vi.unstubAllGlobals();
    }
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
    }, async (url) => url);
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
      subtitleTracks: [],
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

  test('rejects a partial response returned after a browser-request resume retry', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-browser-request-retry-'));
    const moduleDirectory = path.join(tempDir, 'python');
    const outputPath = path.join(tempDir, 'source');
    const requestLogPath = path.join(tempDir, 'requests.jsonl');
    fs.mkdirSync(moduleDirectory);
    fs.writeFileSync(path.join(moduleDirectory, 'curl_cffi.py'), `
import json
import os


class Response:
    def __init__(self, headers):
        self.status_code = 206
        self.headers = headers

    def close(self):
        pass

    def iter_content(self, chunk_size):
        return [b"bad"]


class Requests:
    @staticmethod
    def get(url, headers, impersonate, stream, timeout, allow_redirects, proxy):
        with open(os.environ["SHV_CURL_CFFI_LOG"], "a") as log:
            log.write(json.dumps({"headers": headers, "allow_redirects": allow_redirects, "proxy": proxy}) + "\\n")
        if headers.get("Range") or headers.get("range"):
            return Response({"Content-Range": "bytes 0-2/10"})
        return Response({})


requests = Requests()
`);
    fs.writeFileSync(outputPath, 'stale');
    const originalPythonPath = process.env.PYTHONPATH;
    const originalRequestLogPath = process.env.SHV_CURL_CFFI_LOG;
    process.env.PYTHONPATH = [moduleDirectory, originalPythonPath].filter(Boolean).join(path.delimiter);
    process.env.SHV_CURL_CFFI_LOG = requestLogPath;
    const candidate: MediaCandidate = {
      bitrate: null,
      confidence: 0.86,
      contentType: 'video/mp4',
      discoveredAt: new Date().toISOString(),
      durationSeconds: null,
      headers: {},
      id: 'candidate-id',
      jobId: 'job-id',
      kind: 'browser-request',
      manifestType: null,
      resolution: null,
      sizeBytes: 10,
      subtitleTracks: [],
      url: 'https://media.example.test/video.mp4'
    };

    try {
      await expect(new DownloadEngine().download(candidate, outputPath, () => undefined)).rejects.toThrow(
        'Resume retry returned HTTP 206; expected a complete HTTP 200 response'
      );
    } finally {
      if (originalPythonPath === undefined) {
        delete process.env.PYTHONPATH;
      } else {
        process.env.PYTHONPATH = originalPythonPath;
      }
      if (originalRequestLogPath === undefined) {
        delete process.env.SHV_CURL_CFFI_LOG;
      } else {
        process.env.SHV_CURL_CFFI_LOG = originalRequestLogPath;
      }
    }

    const requests = fs.readFileSync(requestLogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as {
      allow_redirects: boolean;
      headers: Record<string, string>;
      proxy: string;
    });
    expect(requests[0].headers.Range).toBe('bytes=5-');
    expect(Object.keys(requests[1].headers).some((name) => name.toLowerCase() === 'range')).toBe(false);
    expect(requests.every((request) => request.allow_redirects === false)).toBe(true);
    expect(requests.every((request) => request.proxy.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(fs.readFileSync(outputPath)).toEqual(Buffer.from('stale'));
  });
});

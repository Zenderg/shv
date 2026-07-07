import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
});

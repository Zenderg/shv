import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { PublicMediaSession } from '../../src/server/utils/publicHttpProxy.js';

describe('PublicMediaSession', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  test('dials the validated snapshot, preserves Host, and blocks a later private DNS answer', async () => {
    const hosts: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      hosts.push(request.headers.host);
      response.writeHead(200, { Connection: 'close' });
      response.end('safe response');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a port');

    let resolutionCount = 0;
    const dialed: string[] = [];
    const session = await PublicMediaSession.start({
      connect: (validatedAddress, port) => {
        dialed.push(validatedAddress);
        return net.connect({ host: '127.0.0.1', port });
      },
      resolve: async () => {
        resolutionCount += 1;
        return resolutionCount === 1
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }];
      }
    });

    try {
      const url = `http://media.example.test:${address.port}/video.mp4`;
      const response = await session.fetch(url, { headers: { Connection: 'close' } });
      await expect(response.text()).resolves.toBe('safe response');
      const blockedResponse = await session.fetch(url, { headers: { Connection: 'close' } });
      expect(blockedResponse.status).toBe(403);
      await blockedResponse.body?.cancel();

      expect(dialed).toEqual(['93.184.216.34']);
      expect(hosts).toEqual([`media.example.test:${address.port}`]);
      expect(resolutionCount).toBe(2);
    } finally {
      await session.close();
    }
  });

  test('rejects a cross-origin HTTPS tunnel before DNS resolution or dialing', async () => {
    let resolved = false;
    let dialed = false;
    const session = await PublicMediaSession.start({
      allowedOrigins: new Set(['https://media.example.test']),
      connect: () => {
        dialed = true;
        throw new Error('Cross-origin tunnel must not be dialed');
      },
      resolve: async () => {
        resolved = true;
        return [{ address: '93.184.216.34', family: 4 }];
      }
    });

    try {
      const proxy = new URL(session.proxyUrl);
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) });
        socket.once('error', reject);
        socket.once('data', (chunk) => {
          resolve(chunk.toString('latin1'));
          socket.destroy();
        });
        socket.once('connect', () => {
          socket.write([
            'CONNECT cdn.example.test:443 HTTP/1.1',
            'Host: cdn.example.test:443',
            '',
            ''
          ].join('\r\n'));
        });
      });

      expect(response).toMatch(/^HTTP\/1\.1 403 /);
      expect(resolved).toBe(false);
      expect(dialed).toBe(false);
    } finally {
      await session.close();
    }
  });
});

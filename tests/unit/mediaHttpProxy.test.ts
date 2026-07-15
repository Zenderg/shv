import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { MediaSession } from '../../src/server/utils/mediaHttpProxy.js';

describe('MediaSession', () => {
  const servers: Array<http.Server | net.Server> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  test('dials resolved DNS snapshots including fake and local addresses while preserving Host', async () => {
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
    const session = await MediaSession.start({
      connect: (resolvedAddress, port) => {
        dialed.push(resolvedAddress);
        return net.connect({ host: '127.0.0.1', port });
      },
      resolve: async () => {
        resolutionCount += 1;
        return resolutionCount === 1
          ? [{ address: '198.18.3.203', family: 4 }]
          : [{ address: '127.0.0.1', family: 4 }];
      }
    });

    try {
      const url = `http://media.example.test:${address.port}/video.mp4`;
      const response = await session.fetch(url, { headers: { Connection: 'close' } });
      await expect(response.text()).resolves.toBe('safe response');
      const localResponse = await session.fetch(url, { headers: { Connection: 'close' } });
      await expect(localResponse.text()).resolves.toBe('safe response');

      expect(dialed).toEqual(['198.18.3.203', '127.0.0.1']);
      expect(hosts).toEqual([`media.example.test:${address.port}`, `media.example.test:${address.port}`]);
      expect(resolutionCount).toBe(2);
    } finally {
      await session.close();
    }
  });

  test('rejects a cross-origin HTTPS tunnel before DNS resolution or dialing', async () => {
    let resolved = false;
    let dialed = false;
    const session = await MediaSession.start({
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
      const response = await sendProxyRequest(session.proxyUrl, [
        'CONNECT cdn.example.test:443 HTTP/1.1',
        'Host: cdn.example.test:443',
        '',
        ''
      ]);

      expect(response).toMatch(/^HTTP\/1\.1 403 /);
      expect(resolved).toBe(false);
      expect(dialed).toBe(false);
    } finally {
      await session.close();
    }
  });

  test('allows a same-origin HTTPS tunnel through a fake-IP DNS snapshot', async () => {
    const upstream = net.createServer();
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Upstream server did not expose a port');

    const dialed: string[] = [];
    const origin = `https://media.example.test:${address.port}`;
    const session = await MediaSession.start({
      allowedOrigins: new Set([origin]),
      connect: (resolvedAddress, port) => {
        dialed.push(resolvedAddress);
        return net.connect({ host: '127.0.0.1', port });
      },
      resolve: async () => [{ address: '198.18.3.203', family: 4 }]
    });

    try {
      const response = await sendProxyRequest(session.proxyUrl, [
        `CONNECT media.example.test:${address.port} HTTP/1.1`,
        `Host: media.example.test:${address.port}`,
        '',
        ''
      ]);

      expect(response).toMatch(/^HTTP\/1\.1 200 Connection Established/);
      expect(dialed).toEqual(['198.18.3.203']);
    } finally {
      await session.close();
    }
  });

  test('returns an upstream error when system DNS resolution fails', async () => {
    let dialed = false;
    const session = await MediaSession.start({
      connect: () => {
        dialed = true;
        throw new Error('Unresolved destinations must not be dialed');
      },
      resolve: async () => {
        throw new Error('DNS unavailable');
      }
    });

    try {
      const response = await sendProxyRequest(session.proxyUrl, [
        'CONNECT media.example.test:443 HTTP/1.1',
        'Host: media.example.test:443',
        '',
        ''
      ]);

      expect(response).toMatch(/^HTTP\/1\.1 502 Destination resolution failed/);
      expect(dialed).toBe(false);
    } finally {
      await session.close();
    }
  });

  test('returns an upstream error when the connector throws synchronously', async () => {
    const session = await MediaSession.start({
      connect: () => {
        throw new Error('Connector unavailable');
      },
      resolve: async () => [{ address: '198.18.3.203', family: 4 }]
    });

    try {
      const response = await sendProxyRequest(session.proxyUrl, [
        'CONNECT media.example.test:443 HTTP/1.1',
        'Host: media.example.test:443',
        '',
        ''
      ]);

      expect(response).toMatch(/^HTTP\/1\.1 502 Upstream connection failed/);
    } finally {
      await session.close();
    }
  });
});

async function sendProxyRequest(proxyUrl: string, lines: string[]): Promise<string> {
  const proxy = new URL(proxyUrl);
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) });
    socket.once('error', reject);
    socket.once('data', (chunk) => {
      resolve(chunk.toString('latin1'));
      socket.destroy();
    });
    socket.once('connect', () => socket.write(lines.join('\r\n')));
  });
}

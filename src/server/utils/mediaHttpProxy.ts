import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { ProxyAgent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';
import { normalizeHttpUrl } from './mediaUrl.js';

const MAX_PROXY_HEADER_BYTES = 64 * 1024;

export interface ResolvedMediaAddress {
  address: string;
  family: 4 | 6;
}

export type HostnameResolver = (hostname: string) => Promise<ResolvedMediaAddress[]>;
export type MediaProxyConnector = (address: string, port: number) => net.Socket;

export interface MediaHttpProxyOptions {
  allowedOrigins?: ReadonlySet<string>;
  connect?: MediaProxyConnector;
  resolve?: HostnameResolver;
}

export interface MediaSessionLike {
  readonly proxyUrl: string;
  close(): Promise<void>;
  fetch(url: string, init?: Omit<RequestInit, 'dispatcher'>): Promise<Response>;
}

export class MediaSession implements MediaSessionLike {
  private constructor(
    private readonly proxy: MediaHttpProxy,
    private readonly dispatcher: ProxyAgent,
    readonly proxyUrl: string
  ) {}

  static async start(options: MediaHttpProxyOptions = {}): Promise<MediaSession> {
    const proxy = new MediaHttpProxy(options);
    const proxyUrl = await proxy.start();
    return new MediaSession(proxy, new ProxyAgent(proxyUrl), proxyUrl);
  }

  fetch(url: string, init: Omit<RequestInit, 'dispatcher'> = {}): Promise<Response> {
    return undiciFetch(url, { ...init, dispatcher: this.dispatcher });
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
    await this.proxy.stop();
  }
}

/**
 * A loopback-only HTTP/CONNECT proxy that resolves each destination and dials
 * an IP from that exact system DNS snapshot. Optional origin restrictions keep
 * captured request headers from following ffmpeg redirects to another origin.
 */
export class MediaHttpProxy {
  private readonly server = net.createServer((socket) => this.handle(socket));
  private readonly sockets = new Set<net.Socket>();
  private readonly connect: MediaProxyConnector;
  private readonly resolve?: HostnameResolver;
  private readonly allowedOrigins?: ReadonlySet<string>;
  private started = false;

  constructor(options: MediaHttpProxyOptions = {}) {
    this.connect = options.connect ?? ((address, port) => net.connect({ host: address, port }));
    this.resolve = options.resolve;
    this.allowedOrigins = options.allowedOrigins;
    this.server.on('connection', (socket) => this.track(socket));
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        this.started = true;
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Media proxy did not expose a TCP port');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    if (!this.started) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }

  private handle(client: net.Socket): void {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > MAX_PROXY_HEADER_BYTES) {
        this.reject(client, 431, 'Request headers too large');
        return;
      }
      const headerEnd = buffered.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      client.off('data', onData);
      void this.forward(client, buffered.subarray(0, headerEnd + 4), buffered.subarray(headerEnd + 4));
    };
    client.on('data', onData);
    client.once('error', () => client.destroy());
  }

  private async forward(client: net.Socket, header: Buffer, remainder: Buffer): Promise<void> {
    try {
      const headerText = header.toString('latin1');
      const lines = headerText.split('\r\n');
      const [method, target, version] = (lines[0] ?? '').split(' ');
      if (!method || !target || !version?.startsWith('HTTP/')) {
        throw new Error('Malformed proxy request');
      }

      const isConnect = method.toUpperCase() === 'CONNECT';
      const targetUrl = isConnect ? parseConnectTarget(target) : new URL(normalizeHttpUrl(target));
      if (!isConnect && targetUrl.protocol !== 'http:') {
        throw new Error('HTTPS proxy requests must use CONNECT');
      }
      if (this.allowedOrigins && !this.allowedOrigins.has(targetUrl.origin)) {
        throw new Error('Destination origin rejected');
      }
      const port = parsePort(targetUrl);
      let addresses: ResolvedMediaAddress[];
      try {
        addresses = await resolveHostname(targetUrl.hostname, this.resolve);
      } catch {
        this.reject(client, 502, 'Destination resolution failed');
        return;
      }
      let upstream: net.Socket;
      try {
        upstream = this.connect(addresses[0].address, port);
      } catch {
        this.reject(client, 502, 'Upstream connection failed');
        return;
      }
      this.track(upstream);

      upstream.once('connect', () => {
        if (isConnect) {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          upstream.write(buildForwardHeader(method, targetUrl, version, lines.slice(1)));
        }
        if (remainder.length > 0) upstream.write(remainder);
        client.pipe(upstream).pipe(client);
      });
      upstream.once('error', () => this.reject(client, 502, 'Upstream connection failed'));
    } catch {
      this.reject(client, 403, 'Destination rejected');
    }
  }

  private reject(socket: net.Socket, status: number, message: string): void {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

const systemResolver: HostnameResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

async function resolveHostname(
  rawHostname: string,
  resolver: HostnameResolver = systemResolver
): Promise<ResolvedMediaAddress[]> {
  const hostname = rawHostname.replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(hostname);
  const addresses = family === 0
    ? await resolver(hostname)
    : [{ address: hostname, family: family as 4 | 6 }];
  if (addresses.length === 0) {
    throw new Error(`Media hostname did not resolve: ${rawHostname}`);
  }
  return addresses;
}

function parseConnectTarget(target: string): URL {
  const parsed = new URL(`https://${target}`);
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Invalid CONNECT target');
  }
  return parsed;
}

function parsePort(target: URL): number {
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid destination port');
  }
  return port;
}

function buildForwardHeader(method: string, target: URL, version: string, lines: string[]): Buffer {
  const forwarded = lines.filter((line) => {
    const name = line.slice(0, line.indexOf(':')).trim().toLowerCase();
    return name !== 'connection' && name !== 'host' && name !== 'proxy-authorization' && name !== 'proxy-connection';
  });
  while (forwarded.at(-1) === '') forwarded.pop();
  return Buffer.from([
    `${method} ${target.pathname}${target.search} ${version}`,
    `Host: ${target.host}`,
    'Connection: close',
    ...forwarded,
    '',
    ''
  ].join('\r\n'), 'latin1');
}

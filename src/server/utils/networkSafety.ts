import { lookup } from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

export type HostnameResolver = (hostname: string) => Promise<ResolvedPublicAddress[]>;

const systemResolver: HostnameResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
};

/**
 * Preflights a URL for callers that only need validation. Network transports
 * must additionally connect to an address returned by resolvePublicHostname()
 * so DNS cannot change between validation and connection.
 */
export async function assertPublicHttpUrl(rawUrl: string, resolver: HostnameResolver = systemResolver): Promise<string> {
  const normalized = assertPublicHttpUrlSyntax(rawUrl);
  const parsed = new URL(normalized);
  await resolvePublicHostname(parsed.hostname, resolver);
  return normalized;
}

/**
 * Resolves and validates one immutable connection snapshot. Every answer must
 * be globally routable; callers then connect directly to one returned IP.
 */
export async function resolvePublicHostname(
  rawHostname: string,
  resolver: HostnameResolver = systemResolver
): Promise<ResolvedPublicAddress[]> {
  const hostname = rawHostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`Media URL must target a public address: ${rawHostname}`);
  }

  const family = net.isIP(hostname);
  const addresses = family === 0
    ? await resolver(hostname)
    : [{ address: hostname, family: family as 4 | 6 }];

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error(`Media URL must resolve to a public address: ${rawHostname}`);
  }
  return addresses;
}

/**
 * Synchronous form for manifest parsers and ffmpeg argument builders. Runtime
 * network connections must also go through the connection-bound proxy.
 */
export function assertPublicHttpUrlSyntax(rawUrl: string): string {
  const normalized = normalizeHttpUrl(rawUrl);
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || (net.isIP(hostname) !== 0 && !isPublicAddress(hostname))
  ) {
    throw new Error(`Media URL must target a public address: ${parsed.host}`);
  }
  return normalized;
}

export function normalizeHttpUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Media URL must be a valid HTTP(S) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Media URL must use HTTP or HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Media URL must not include credentials');
  }
  return parsed.toString();
}

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) {
    return false;
  }
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsed as ipaddr.IPv6).toIPv4Address().range() === 'unicast';
  }
  return parsed.range() === 'unicast';
}

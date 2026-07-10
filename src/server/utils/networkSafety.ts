import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Validates a URL before a downloader, browser, or media tool can make a
 * network request. This is intentionally stricter than a generic URL parser:
 * media inputs must be public HTTP(S) destinations.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<string> {
  const normalized = assertPublicHttpUrlSyntax(rawUrl);
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(hostname) !== 0) {
    return normalized;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isPrivateOrReservedAddress(address.address))) {
    throw new Error(`Media URL must resolve to a public address: ${parsed.host}`);
  }

  return normalized;
}

/**
 * Synchronous form for manifest parsers and ffmpeg argument builders. Runtime
 * callers must also use assertPublicHttpUrl() to validate DNS results.
 */
export function assertPublicHttpUrlSyntax(rawUrl: string): string {
  const normalized = normalizeHttpUrl(rawUrl);
  const parsed = new URL(normalized);

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || isPrivateOrReservedAddress(hostname)
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

  return parsed.toString();
}

function isPrivateOrReservedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [first = 0, second = 0, third = 0] = address.split('.').map(Number);
    return (
      first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0 && third === 0)
      || (first === 192 && second === 0 && third === 2)
      || (first === 192 && second === 88 && third === 99)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 198 && second === 51 && third === 100)
      || (first === 203 && second === 0 && third === 113)
      || first >= 224
    );
  }
  if (family !== 6) {
    return false;
  }

  const value = parseIpv6(address);
  return value === 0n
    || value === 1n
    || inIpv6Range(value, '::ffff:0:0', 96)
    || inIpv6Range(value, '100::', 64)
    || inIpv6Range(value, '2001:10::', 28)
    || inIpv6Range(value, '2001:db8::', 32)
    || inIpv6Range(value, 'fc00::', 7)
    || inIpv6Range(value, 'fe80::', 10)
    || inIpv6Range(value, 'ff00::', 8);
}

function inIpv6Range(value: bigint, prefix: string, bits: number): boolean {
  const shift = 128n - BigInt(bits);
  return (value >> shift) === (parseIpv6(prefix) >> shift);
}

function parseIpv6(address: string): bigint {
  const [left, right] = address.toLowerCase().split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const parts = [...leftParts, ...Array(Math.max(0, 8 - leftParts.length - rightParts.length)).fill('0'), ...rightParts];
  return BigInt(`0x${parts.map((part) => part.padStart(4, '0')).join('')}`);
}

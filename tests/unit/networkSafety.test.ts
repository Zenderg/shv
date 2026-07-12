import { describe, expect, test } from 'vitest';
import { assertPublicHttpUrl, assertPublicHttpUrlSyntax, isPublicAddress, resolvePublicHostname } from '../../src/server/utils/networkSafety.js';

describe('networkSafety', () => {
  test('rejects non-HTTP(S), loopback, link-local, private, and reserved media URLs', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(/HTTP or HTTPS/);
    await expect(assertPublicHttpUrl('http://127.0.0.1/video.m3u8')).rejects.toThrow(/public address/);
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/public address/);
    await expect(assertPublicHttpUrl('http://192.168.1.1/video.m3u8')).rejects.toThrow(/public address/);
    await expect(assertPublicHttpUrl('http://[::1]/video.m3u8')).rejects.toThrow(/public address/);
    await expect(assertPublicHttpUrl('http://[fd00::1]/video.m3u8')).rejects.toThrow(/public address/);
  });

  test('accepts a public IP address without DNS and keeps synchronous validation strict', async () => {
    await expect(assertPublicHttpUrl('https://1.1.1.1/video.m3u8')).resolves.toBe('https://1.1.1.1/video.m3u8');
    expect(() => assertPublicHttpUrlSyntax('http://127.0.0.1/test.m3u8')).toThrow(/public address/);
  });

  test('rejects credentials, mapped private IPv4, and mixed DNS answer sets', async () => {
    expect(() => assertPublicHttpUrlSyntax('https://user:secret@example.test/video')).toThrow(/credentials/);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    await expect(resolvePublicHostname('media.example.test', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 }
    ])).rejects.toThrow(/public address/);
  });
});

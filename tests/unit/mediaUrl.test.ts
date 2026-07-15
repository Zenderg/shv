import { describe, expect, test } from 'vitest';
import { normalizeHttpUrl } from '../../src/server/utils/mediaUrl.js';

describe('normalizeHttpUrl', () => {
  test.each([
    'http://localhost/video.mp4',
    'http://127.0.0.1/video.m3u8',
    'http://169.254.169.254/media',
    'http://192.168.1.1/video.m3u8',
    'http://198.18.3.203/video.mp4',
    'http://[::1]/video.m3u8',
    'http://[fd00::1]/video.m3u8',
    'https://1.1.1.1/video.m3u8'
  ])('accepts an HTTP(S) destination reachable through container networking: %s', (url) => {
    expect(normalizeHttpUrl(url)).toBe(url);
  });

  test.each([
    'file:///etc/passwd',
    'ftp://example.test/video.mp4',
    'not a URL'
  ])('rejects a non-HTTP(S) or malformed URL: %s', (url) => {
    expect(() => normalizeHttpUrl(url)).toThrow(/valid HTTP\(S\)|HTTP or HTTPS/);
  });

  test('rejects embedded URL credentials', () => {
    expect(() => normalizeHttpUrl('https://user:secret@example.test/video')).toThrow(/credentials/);
  });
});

import { describe, expect, test } from 'vitest';
import {
  canDownloadPlainHlsSegments,
  parseHlsDurationSeconds,
  parseHlsSegments,
  parseHlsVariants,
  selectBestHlsVariant
} from '../../src/server/download-engine/hls.js';

describe('HLS parsing', () => {
  const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080
high/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1600000,RESOLUTION=1280x720
mid/index.m3u8`;

  test('sorts variants by bandwidth and resolves relative URLs', () => {
    const variants = parseHlsVariants(manifest, 'https://example.test/master.m3u8');
    expect(variants.map((variant) => variant.resolution)).toEqual(['1920x1080', '1280x720', '640x360']);
    expect(variants[0].uri).toBe('https://example.test/high/index.m3u8');
  });

  test('falls back to the original manifest when no variants exist', () => {
    expect(selectBestHlsVariant('#EXTM3U\n#EXTINF:4,\nsegment.ts', 'https://example.test/media.m3u8')).toBe(
      'https://example.test/media.m3u8'
    );
  });

  test('sums media segment durations for download progress', () => {
    const mediaManifest = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:3.96,
seg-1.ts
#EXTINF:4,
seg-2.ts
#EXTINF:2.52,
seg-3.ts`;

    expect(parseHlsDurationSeconds(mediaManifest)).toBeCloseTo(10.48);
  });

  test('identifies plain TS media segments that can be downloaded directly', () => {
    const mediaManifest = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:3.96,
seg-1.ts?h=token
#EXTINF:4,
https://cdn.example.test/video/seg-2.ts?h=token
#EXT-X-ENDLIST`;

    const segments = parseHlsSegments(mediaManifest, 'https://example.test/video/index.m3u8');

    expect(segments).toEqual([
      { durationSeconds: 3.96, uri: 'https://example.test/video/seg-1.ts?h=token' },
      { durationSeconds: 4, uri: 'https://cdn.example.test/video/seg-2.ts?h=token' }
    ]);
    expect(canDownloadPlainHlsSegments(mediaManifest, segments)).toBe(true);
  });

  test('keeps complex HLS playlists on the ffmpeg fallback path', () => {
    const encryptedManifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
seg-1.ts`;

    expect(canDownloadPlainHlsSegments(encryptedManifest, parseHlsSegments(encryptedManifest, 'https://example.test/index.m3u8'))).toBe(false);
  });

  test('returns null when a playlist has no media segment durations', () => {
    expect(parseHlsDurationSeconds(manifest)).toBeNull();
  });
});

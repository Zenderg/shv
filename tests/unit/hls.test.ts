import { describe, expect, test } from 'vitest';
import {
  canDownloadPlainHlsSegments,
  completeHlsSegmentDurationSeconds,
  parseHlsDurationSeconds,
  parseHlsResourceUrls,
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

  test('keeps quoted commas inside HLS stream attributes', () => {
    const quotedAttributeManifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3200000,VIDEO="main,BANDWIDTH=1",CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080
high/index.m3u8`;

    const variants = parseHlsVariants(quotedAttributeManifest, 'https://example.test/master.m3u8');

    expect(variants.map((variant) => variant.uri)).toEqual([
      'https://example.test/high/index.m3u8',
      'https://example.test/low/index.m3u8'
    ]);
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

  test('requires a valid EXTINF duration for every media segment', () => {
    const partialDurationManifest = `#EXTM3U
#EXTINF:4,
seg-1.ts
seg-2.ts`;

    const segments = parseHlsSegments(partialDurationManifest, 'https://example.test/video/index.m3u8');

    expect(parseHlsDurationSeconds(partialDurationManifest)).toBeNull();
    expect(completeHlsSegmentDurationSeconds(segments)).toBeNull();
  });

  test('accepts duration-based progress only when every parsed segment duration is positive and finite', () => {
    expect(completeHlsSegmentDurationSeconds([
      { durationSeconds: 3.5, uri: 'https://example.test/seg-1.ts' },
      { durationSeconds: 4, uri: 'https://example.test/seg-2.ts' }
    ])).toBe(7.5);
    expect(completeHlsSegmentDurationSeconds([
      { durationSeconds: 3.5, uri: 'https://example.test/seg-1.ts' },
      { durationSeconds: 0, uri: 'https://example.test/seg-2.ts' }
    ])).toBeNull();
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

  test('collects segment, key, and init-map URLs for header scoping', () => {
    const resourceManifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.test/key.bin"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
https://cdn.example.test/seg-1.m4s`;

    expect(parseHlsResourceUrls(resourceManifest, 'https://media.example.test/index.m3u8')).toEqual([
      'https://cdn.example.test/seg-1.m4s',
      'https://keys.example.test/key.bin',
      'https://media.example.test/init.mp4'
    ]);
  });

  test('returns null when a playlist has no media segment durations', () => {
    expect(parseHlsDurationSeconds(manifest)).toBeNull();
  });
});

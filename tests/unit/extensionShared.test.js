import { describe, expect, test } from 'vitest';
import {
  candidateFromVerifiedVideoUrl,
  candidateFromUrl,
  candidateRejectionReason,
  mergeCandidates,
  parseHlsManifestMetadata,
  subtitleTrackFromUrl,
  sessionTabIdsForRequest
} from '../../extension/chrome-source-helper/shared.js';

describe('extension shared candidate detection', () => {
  test('rejects browser-local and explicit byte-range media URLs', () => {
    expect(candidateFromUrl('blob:https://example.test/video-id', 'video/mp4')).toBeNull();
    expect(candidateFromUrl('https://media.example.test/video?bytes=0-6402', 'video/webm')).toBeNull();
  });

  test('accepts complete manifest and direct video URLs', () => {
    expect(candidateFromUrl('https://media.example.test/manifest.mpd', 'application/dash+xml')?.kind).toBe('dash');
    expect(candidateFromUrl('https://media.example.test/video.mp4', 'video/mp4')?.kind).toBe('browser-request');
  });

  test('merges candidate metadata updates without discarding request context', () => {
    const existing = candidateFromUrl('https://media.example.test/video.mp4', 'video/mp4');
    existing.headers = { Referer: 'https://source.example.test/watch' };
    const metadataUpdate = {
      ...existing,
      durationSeconds: 42.4,
      headers: {},
      resolution: '1920x1080'
    };

    expect(mergeCandidates([existing], [metadataUpdate])).toEqual([
      expect.objectContaining({
        durationSeconds: 42.4,
        headers: { Referer: 'https://source.example.test/watch' },
        resolution: '1920x1080',
        url: 'https://media.example.test/video.mp4'
      })
    ]);
  });

  test('accepts relative DOM media URLs against the page URL', () => {
    const candidate = candidateFromUrl('/media/video.mp4', null, 'html-video', 'https://source.example.test/watch');

    expect(candidate?.url).toBe('https://source.example.test/media/video.mp4');
    expect(candidate?.kind).toBe('html-video');
  });

  test('accepts extensionless media URLs with an explicit video mime query hint', () => {
    const candidate = candidateFromUrl('https://rr1---sn.example.test/videoplayback?mime=video%2Fmp4&clen=12345');

    expect(candidate?.kind).toBe('browser-request');
    expect(candidate?.contentType).toBe('video/mp4');
  });

  test('accepts verified video element currentSrc URLs without extension or mime hints', () => {
    const url = 'https://vkvd531.okcdn.ru/?expires=1783762251943&type=0&sig=test';

    expect(candidateFromUrl(url)).toBeNull();
    expect(candidateFromVerifiedVideoUrl(url)).toMatchObject({
      confidence: 0.91,
      contentType: null,
      kind: 'html-video',
      manifestType: null,
      url
    });
  });

  test('reads HLS variant resolutions from master playlists', () => {
    const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=720x1280
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1920
index-v1-a1.m3u8`;

    expect(parseHlsManifestMetadata(manifest, 'https://iv-h.phncdn.com/videos/1080P/master.m3u8')).toEqual({
      resolution: '1080x1920',
      subtitleTracks: [],
      variants: [
        {
          bandwidth: 4000000,
          resolution: '1080x1920',
          url: 'https://iv-h.phncdn.com/videos/1080P/index-v1-a1.m3u8'
        },
        {
          bandwidth: 1200000,
          resolution: '720x1280',
          url: 'https://iv-h.phncdn.com/videos/1080P/low/index.m3u8'
        }
      ]
    });
  });

  test('does not infer HLS resolution from playlist URL names', () => {
    const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
segment-1.ts`;

    expect(parseHlsManifestMetadata(manifest, 'https://iv-h.phncdn.com/videos/1080P/index-v1-a1.m3u8')).toEqual({
      resolution: null,
      subtitleTracks: [],
      variants: []
    });
  });

  test('reads HLS subtitle renditions from master playlists', () => {
    const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="ru",NAME="Russian",DEFAULT=YES,AUTOSELECT=YES,URI="subtitles/ru.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="https://cdn.example.test/en.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,SUBTITLES="subs"
video/index.m3u8`;

    expect(parseHlsManifestMetadata(manifest, 'https://media.example.test/master.m3u8').subtitleTracks).toEqual([
      {
        contentType: 'application/vnd.apple.mpegurl',
        format: 'hls',
        isDefault: true,
        isSelected: null,
        label: 'Russian',
        language: 'ru',
        source: 'hls-manifest',
        url: 'https://media.example.test/subtitles/ru.m3u8'
      },
      {
        contentType: 'text/vtt',
        format: 'webvtt',
        isDefault: false,
        isSelected: null,
        label: 'English',
        language: 'en',
        source: 'hls-manifest',
        url: 'https://cdn.example.test/en.vtt'
      }
    ]);
  });

  test('detects subtitle network requests by extension and content type', () => {
    expect(subtitleTrackFromUrl('https://cdn.example.test/subtitles/ru.vtt?token=1', null, 'network')).toMatchObject({
      contentType: 'text/vtt',
      format: 'webvtt',
      label: 'Russian',
      language: 'ru',
      source: 'network',
      url: 'https://cdn.example.test/subtitles/ru.vtt?token=1'
    });
    expect(subtitleTrackFromUrl('https://cdn.example.test/episode/01_raw_eng.ass', 'application/octet-stream', 'network')).toMatchObject({
      contentType: 'application/octet-stream',
      format: 'ass',
      label: 'English',
      language: 'en'
    });
    expect(subtitleTrackFromUrl('https://cdn.example.test/subtitles', 'application/x-subrip', 'network')).toMatchObject({
      contentType: 'application/x-subrip',
      format: 'srt'
    });
  });

  test('accepts googlevideo videoplayback URLs when the mime query beats a misleading content-type header', () => {
    const candidate = candidateFromUrl(
      'https://rr3---sn-aj5go5-53.googlevideo.com/videoplayback?expire=1&itag=18&source=youtube&mime=video%2Fmp4&ratebypass=yes',
      'text/plain'
    );

    expect(candidate?.kind).toBe('browser-request');
    expect(candidate?.contentType).toBe('video/mp4');
    expect(candidate?.confidence).toBe(0.86);
  });

  test('rejects YouTube SABR/UMP transport requests', () => {
    const url =
      'https://rr3---sn-aj5go5-53.googlevideo.com/videoplayback?expire=1&source=youtube&sabr=1&rqh=1&rn=1';

    expect(candidateFromUrl(url, 'application/vnd.yt-ump')).toBeNull();
    expect(candidateRejectionReason(url, 'application/vnd.yt-ump')).toBe('YouTube SABR/UMP transport request');
  });

  test('accepts googlevideo playback URLs with UMP content-type when the URL is not an explicit SABR transport', () => {
    const url =
      'https://rr3---sn-aj5go5-53.googlevideo.com/videoplayback?expire=1&ei=x&ip=1.2.3.4&id=o-test&source=youtube&requiressl=yes&xpc=1&cps=1';

    const candidate = candidateFromUrl(url, 'application/vnd.yt-ump');

    expect(candidate?.kind).toBe('browser-request');
    expect(candidateRejectionReason(url, 'application/vnd.yt-ump')).toBe('accepted as googlevideo videoplayback');
  });

  test('rejects explicit range googlevideo videoplayback chunks', () => {
    expect(
      candidateFromUrl(
        'https://rr3---sn-aj5go5-53.googlevideo.com/videoplayback?expire=1&source=youtube&range=0-999999'
      )
    ).toBeNull();
    expect(
      candidateRejectionReason(
        'https://rr3---sn-aj5go5-53.googlevideo.com/videoplayback?expire=1&source=youtube&range=0-999999'
      )
    ).toBe('explicit range query param');
  });

  test('maps tabless media requests back to source sessions by initiator origin', () => {
    const state = {
      activeTabId: 42,
      sessions: {
        42: {
          currentUrl: 'https://www.youtube.com/live/Hogfg_GQAxk',
          sourceUrl: 'https://www.youtube.com/live/Hogfg_GQAxk'
        }
      }
    };

    expect(sessionTabIdsForRequest({ initiator: 'https://www.youtube.com', tabId: -1 }, state)).toEqual([42]);
    expect(sessionTabIdsForRequest({ initiator: 'https://example.test', tabId: -1 }, state)).toEqual([]);
  });

  test('does not map ambiguous tabless requests to every same-origin session', () => {
    const state = {
      activeTabId: 42,
      sessions: {
        42: {
          currentUrl: 'https://www.youtube.com/watch?v=first',
          sourceUrl: 'https://www.youtube.com/watch?v=first'
        },
        43: {
          currentUrl: 'https://www.youtube.com/watch?v=second',
          sourceUrl: 'https://www.youtube.com/watch?v=second'
        }
      }
    };

    expect(sessionTabIdsForRequest({ initiator: 'https://www.youtube.com', tabId: -1 }, state)).toEqual([]);
  });

  test('explains why media-like URLs are rejected by the classifier', () => {
    expect(candidateRejectionReason('blob:https://example.test/video-id', 'video/mp4')).toBe('non-http protocol blob:');
    expect(candidateRejectionReason('https://media.example.test/video?bytes=0-6402', 'video/webm')).toBe('explicit bytes query param');
    expect(candidateRejectionReason('https://rr1---sn.example.test/videoplayback?range=0-1000', null)).toBe(
      'explicit range query param'
    );
  });

});

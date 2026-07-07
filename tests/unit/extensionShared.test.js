import { describe, expect, test } from 'vitest';
import {
  candidateFromUrl,
  candidateRejectionReason,
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

  test('accepts extensionless media URLs with an explicit video mime query hint', () => {
    const candidate = candidateFromUrl('https://rr1---sn.example.test/videoplayback?mime=video%2Fmp4&clen=12345');

    expect(candidate?.kind).toBe('browser-request');
    expect(candidate?.contentType).toBe('video/mp4');
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

  test('explains why media-like URLs are rejected by the classifier', () => {
    expect(candidateRejectionReason('blob:https://example.test/video-id', 'video/mp4')).toBe('non-http protocol blob:');
    expect(candidateRejectionReason('https://media.example.test/video?bytes=0-6402', 'video/webm')).toBe('explicit bytes query param');
    expect(candidateRejectionReason('https://rr1---sn.example.test/videoplayback?range=0-1000', null)).toBe(
      'explicit range query param'
    );
  });

});

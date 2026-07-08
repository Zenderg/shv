import { describe, expect, test } from 'vitest';
import { visibleSidebarCandidates } from '../../src/extension/source-helper/candidateDisplay';
import type { Candidate, SourceSession } from '../../src/extension/source-helper/sidebarStore';

function candidate(url: string, patch: Partial<Candidate> = {}): Candidate {
  return {
    bitrate: null,
    confidence: 0.92,
    contentType: 'application/vnd.apple.mpegurl',
    durationSeconds: null,
    headers: {},
    kind: 'hls',
    manifestType: 'hls',
    resolution: null,
    sizeBytes: null,
    url,
    ...patch
  };
}

function session(candidates: Candidate[], patch: Partial<SourceSession> = {}): SourceSession {
  return {
    activeCaptureUntil: Date.now() + 30000,
    candidates,
    jobId: 'job-id',
    sourceUrl: 'https://source.example.test/watch',
    status: 'listening',
    ...patch
  };
}

describe('source sidebar candidate display', () => {
  test('shows the concrete HLS playlist for the active playback resolution', () => {
    const master1080 = candidate('https://cdn.example.test/video/1080P/master.m3u8', { resolution: '1080x1920' });
    const media1080 = candidate('https://cdn.example.test/video/1080P/index-v1-a1.m3u8', { resolution: '1080x1920' });
    const media720 = candidate('https://cdn.example.test/video/720P/index-v1-a1.m3u8', { resolution: '720x1280' });

    expect(
      visibleSidebarCandidates(
        session([master1080, media1080, media720], {
          activePlaybackMetadata: { currentSrc: null, durationSeconds: 120, resolution: '1080x1920' }
        })
      ).map((item) => item.url)
    ).toEqual([media1080.url]);
  });

  test('keeps all distinct candidates when there is no active playback match', () => {
    const hls = candidate('https://cdn.example.test/video/master.m3u8');
    const direct = candidate('https://cdn.example.test/video.mp4', {
      contentType: 'video/mp4',
      kind: 'browser-request',
      manifestType: null
    });

    expect(visibleSidebarCandidates(session([hls, direct]))).toEqual([hls, direct]);
  });

  test('keeps separate HLS families that share the active resolution', () => {
    const first = candidate('https://cdn.example.test/first/1080P/index-v1-a1.m3u8', { resolution: '1080x1920' });
    const second = candidate('https://cdn.example.test/second/1080P/index-v1-a1.m3u8', { resolution: '1080x1920' });

    expect(
      visibleSidebarCandidates(
        session([first, second], {
          activePlaybackMetadata: { currentSrc: null, durationSeconds: 120, resolution: '1080x1920' }
        })
      )
    ).toEqual([first, second]);
  });
});

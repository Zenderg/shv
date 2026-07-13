import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { downloadSelectedSubtitleTracks } from '../../src/server/jobs/subtitleDownload.js';
import type { TaskProgressUpdate } from '../../src/server/utils/taskProgress.js';
import type { MediaCandidate, SubtitleTrack } from '../../src/shared/types.js';

describe('subtitle download progress', () => {
  test('reports HLS progress by completed segments instead of per-response bytes', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-subtitle-hls-progress-'));
    const manifest = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:4,',
      'segment-1.vtt',
      '#EXTINF:4,',
      'segment-2.vtt',
      '#EXT-X-ENDLIST',
      ''
    ].join('\n');
    const responses = new Map([
      ['https://media.example.test/subtitles/index.m3u8', responseWithLength(manifest)],
      ['https://media.example.test/subtitles/segment-1.vtt', responseWithLength('WEBVTT\n\nfirst')],
      ['https://media.example.test/subtitles/segment-2.vtt', responseWithLength('WEBVTT\n\nsecond')]
    ]);
    const fetch = vi.fn(async (url: string) => {
      const response = responses.get(url);
      if (!response) throw new Error(`Unexpected subtitle URL: ${url}`);
      return response;
    });
    const updates: TaskProgressUpdate[] = [];

    await downloadSelectedSubtitleTracks({
      candidate: candidateWithTrack(subtitleTrack('https://media.example.test/subtitles/index.m3u8', 'hls')),
      createMediaSession: async () => ({ close: async () => undefined, fetch, proxyUrl: 'http://127.0.0.1:1' }) as never,
      onProgress: (update) => updates.push(update),
      signal: new AbortController().signal,
      workDir
    });

    expect(progressFractions(updates)).toEqual([0.5, 0.99]);
    expect(updates).toContainEqual({ kind: 'activity', label: 'Downloading subtitles' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('keeps a single subtitle file determinate when Content-Length is known', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-subtitle-file-progress-'));
    const fetch = vi.fn(async () => responseWithLength('WEBVTT\n\nsingle file'));
    const updates: TaskProgressUpdate[] = [];

    await downloadSelectedSubtitleTracks({
      candidate: candidateWithTrack(subtitleTrack('https://media.example.test/subtitles/en.vtt', 'webvtt')),
      createMediaSession: async () => ({ close: async () => undefined, fetch, proxyUrl: 'http://127.0.0.1:1' }) as never,
      onProgress: (update) => updates.push(update),
      signal: new AbortController().signal,
      workDir
    });

    expect(progressFractions(updates)).toEqual([0.99]);
  });
});

function responseWithLength(body: string): Response {
  return new Response(body, { headers: { 'content-length': String(Buffer.byteLength(body)) } });
}

function progressFractions(updates: TaskProgressUpdate[]): number[] {
  return updates.flatMap((update) => update.kind === 'progress' ? [update.fraction] : []);
}

function candidateWithTrack(track: SubtitleTrack): MediaCandidate {
  return {
    bitrate: null,
    confidence: 1,
    contentType: 'video/mp4',
    discoveredAt: new Date().toISOString(),
    durationSeconds: null,
    headers: {},
    id: 'candidate-id',
    jobId: 'job-id',
    kind: 'direct',
    manifestType: null,
    resolution: null,
    sizeBytes: null,
    subtitleTracks: [track],
    url: 'https://media.example.test/video.mp4'
  };
}

function subtitleTrack(url: string, format: SubtitleTrack['format']): SubtitleTrack {
  return {
    contentType: format === 'hls' ? 'application/vnd.apple.mpegurl' : 'text/vtt',
    format,
    isDefault: false,
    isSelected: true,
    label: 'English',
    language: 'en',
    source: 'network',
    url
  };
}

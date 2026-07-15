import fs from 'node:fs';
import path from 'node:path';
import type { MediaCandidate, SubtitleTrack } from '../../shared/types.js';
import { onAbort, throwIfAborted } from '../utils/cancellation.js';
import { requestHeadersForUrl } from '../utils/downloadRequestHeaders.js';
import { logJobEvent, safeUrlParts } from '../utils/jobLogger.js';
import type { MediaSessionLike } from '../utils/mediaHttpProxy.js';
import { normalizeHttpUrl } from '../utils/mediaUrl.js';
import { activityUpdate, progressUpdate, type TaskProgressCallback } from '../utils/taskProgress.js';

const MAX_SUBTITLE_REDIRECTS = 5;
type MediaResponse = Awaited<ReturnType<MediaSessionLike['fetch']>>;
export type MediaSessionFactory = () => Promise<MediaSessionLike>;

interface DownloadSelectedSubtitleTracksInput {
  candidate: MediaCandidate;
  createMediaSession: MediaSessionFactory;
  onProgress: TaskProgressCallback;
  signal: AbortSignal;
  workDir: string;
}

export async function downloadSelectedSubtitleTracks({
  candidate,
  createMediaSession,
  onProgress,
  signal,
  workDir
}: DownloadSelectedSubtitleTracksInput): Promise<Array<SubtitleTrack & { localPath: string }>> {
  const tracks = subtitleTracksForDownload(candidate);
  if (tracks.length === 0) return [];

  const subtitleDir = path.join(workDir, 'subtitles');
  fs.mkdirSync(subtitleDir, { recursive: true });
  const downloaded: Array<SubtitleTrack & { localPath: string }> = [];
  const session = await createMediaSession();
  try {
    for (const [index, track] of tracks.entries()) {
      throwIfAborted(signal);
      const localPath = path.join(subtitleDir, `subtitle-${index + 1}${subtitleExtension(track)}`);
      if (track.format === 'hls') {
        await downloadHlsSubtitleTrack(track, localPath, candidate.url, candidate.headers, session, onProgress, signal);
      } else {
        await downloadSubtitleFile(track, localPath, candidate.url, candidate.headers, session, onProgress, signal);
      }
      downloaded.push({ ...track, localPath });
      logJobEvent('info', 'subtitle-downloaded', {
        format: track.format,
        jobId: candidate.jobId,
        label: track.label,
        language: track.language,
        source: track.source
      });
    }
  } finally {
    await session.close();
  }
  return downloaded;
}

export function subtitleTracksForDownload(candidate: MediaCandidate): SubtitleTrack[] {
  const supported = candidate.subtitleTracks.filter((track) => ['webvtt', 'srt', 'ass', 'hls'].includes(track.format));
  const selected = supported.find((track) => track.isSelected === true);
  return selected ? [selected] : [];
}

export function subtitleDownloadHeaders(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  targetUrl: string
): Record<string, string> {
  return {
    ...requestHeadersForUrl(candidateHeaders, candidateUrl, targetUrl),
    ...requestHeadersForUrl(track.headers ?? {}, track.url, targetUrl)
  };
}

function subtitleExtension(track: SubtitleTrack): string {
  if (track.format === 'srt') return '.srt';
  if (track.format === 'ass') return '.ass';
  if (track.format === 'hls') return '.m3u8';
  return '.vtt';
}

async function downloadSubtitleFile(
  track: SubtitleTrack,
  localPath: string,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  session: MediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<void> {
  const body = await fetchSubtitleBinary(track, candidateUrl, candidateHeaders, track.url, session, onProgress, signal);
  fs.writeFileSync(localPath, body);
}

async function downloadHlsSubtitleTrack(
  track: SubtitleTrack,
  localPath: string,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  session: MediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<void> {
  const onResourceActivity: TaskProgressCallback = () => onProgress(activityUpdate('Downloading subtitles'));
  const manifest = await fetchSubtitleText(
    track,
    candidateUrl,
    candidateHeaders,
    track.url,
    session,
    onResourceActivity,
    signal
  );
  const directory = path.dirname(localPath);
  const segmentLines = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  let segmentIndex = 0;
  const rewrittenLines: string[] = [];
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      rewrittenLines.push(line);
      continue;
    }
    segmentIndex += 1;
    const segmentUrl = normalizeHttpUrl(new URL(trimmed, track.url).toString());
    const segmentExtension = path.extname(new URL(segmentUrl).pathname) || '.vtt';
    const segmentName = `subtitle-segment-${segmentIndex}${segmentExtension}`;
    const segmentPath = path.join(directory, segmentName);
    const body = await fetchSubtitleBinary(
      track,
      candidateUrl,
      candidateHeaders,
      segmentUrl,
      session,
      onResourceActivity,
      signal
    );
    fs.writeFileSync(segmentPath, body);
    onProgress(progressUpdate(Math.min(0.99, segmentIndex / segmentLines.length), 'Downloading subtitles'));
    rewrittenLines.push(segmentName);
  }
  if (segmentIndex === 0) {
    throw new Error(`Subtitle HLS playlist did not contain subtitle segments: ${safeUrlParts(track.url).host}${safeUrlParts(track.url).path}`);
  }
  fs.writeFileSync(localPath, `${rewrittenLines.join('\n')}\n`);
}

async function fetchSubtitleText(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: MediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<string> {
  const response = await fetchSubtitleResponse(track, candidateUrl, candidateHeaders, url, session, signal);
  return (await readSubtitleResponse(response, onProgress, signal)).toString('utf8');
}

async function fetchSubtitleBinary(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: MediaSessionLike,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<Buffer> {
  const response = await fetchSubtitleResponse(track, candidateUrl, candidateHeaders, url, session, signal);
  return readSubtitleResponse(response, onProgress, signal);
}

async function readSubtitleResponse(
  response: MediaResponse,
  onProgress: TaskProgressCallback,
  signal: AbortSignal
): Promise<Buffer> {
  if (!response.body) throw new Error('Subtitle response did not include a body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let receivedBytes = 0;
  const removeAbortListener = onAbort(signal, () => void reader.cancel().catch(() => undefined));
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      receivedBytes += chunk.byteLength;
      onProgress(
        Number.isFinite(totalBytes) && totalBytes > 0
          ? progressUpdate(Math.min(0.99, receivedBytes / totalBytes), 'Downloading subtitles')
          : activityUpdate()
      );
    }
  } finally {
    removeAbortListener();
  }
  return Buffer.concat(chunks);
}

async function fetchSubtitleResponse(
  track: SubtitleTrack,
  candidateUrl: string,
  candidateHeaders: Record<string, string>,
  url: string,
  session: MediaSessionLike,
  signal: AbortSignal
) {
  let targetUrl = normalizeHttpUrl(url);
  for (let redirectCount = 0; redirectCount <= MAX_SUBTITLE_REDIRECTS; redirectCount += 1) {
    const response = await session.fetch(targetUrl, {
      headers: subtitleDownloadHeaders(track, candidateUrl, candidateHeaders, targetUrl),
      redirect: 'manual',
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Subtitle request failed with HTTP ${response.status}: ${safeUrlParts(targetUrl).host}${safeUrlParts(targetUrl).path}`);
      }
      return response;
    }
    const location = response.headers.get('location');
    if (!location) {
      await response.body?.cancel();
      throw new Error(`Subtitle request returned redirect HTTP ${response.status} without a location`);
    }
    await response.body?.cancel();
    if (redirectCount === MAX_SUBTITLE_REDIRECTS) {
      throw new Error(`Subtitle request exceeded ${MAX_SUBTITLE_REDIRECTS} redirects`);
    }
    targetUrl = normalizeHttpUrl(new URL(location, targetUrl).toString());
  }
  throw new Error('Subtitle redirect handling failed unexpectedly');
}

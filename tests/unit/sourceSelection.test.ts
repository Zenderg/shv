import { describe, expect, test } from 'vitest';
import { sourceSelectionDisabledReason, sourceSelectionButtonLabel } from '../../src/extension/source-helper/sourceSelection';
import type { Candidate, SourceSession } from '../../src/extension/source-helper/sidebarStore';

const candidate: Candidate = {
  bitrate: null,
  confidence: 0.91,
  contentType: 'video/mp4',
  durationSeconds: null,
  headers: {},
  kind: 'html-video',
  manifestType: null,
  resolution: '1920x1080',
  sizeBytes: null,
  url: 'https://media.example.test/video.mp4'
};

function session(overrides: Partial<SourceSession> = {}): SourceSession {
  return {
    activeCaptureUntil: Date.now() + 30_000,
    candidates: [candidate],
    jobId: 'job-id',
    selectedUrl: null,
    sourceUrl: 'https://source.example.test/watch',
    status: 'listening',
    ...overrides
  };
}

describe('source selection UI state', () => {
  test('requires playback to resume after the active video pauses', () => {
    const pausedSession = session({ playbackState: 'inactive' });

    expect(sourceSelectionDisabledReason(pausedSession, Date.now())).toBe('Resume playback');
    expect(sourceSelectionButtonLabel(candidate, pausedSession, [], Date.now())).toBe('Resume playback');
  });

  test('does not block manual-capture sessions when playback visibility is unknown', () => {
    const manualCaptureSession = session({ activePlaybackUntil: null, playbackState: null });

    expect(sourceSelectionDisabledReason(manualCaptureSession, Date.now())).toBeNull();
    expect(sourceSelectionButtonLabel(candidate, manualCaptureSession, [], Date.now())).toBe('Use source');
  });

  test('labels only the selected candidate after source selection', () => {
    const selectedSession = session({
      selectedUrl: candidate.url,
      status: 'selected'
    });
    const otherCandidate = {
      ...candidate,
      url: 'https://media.example.test/other.mp4'
    };

    expect(sourceSelectionButtonLabel(candidate, selectedSession, [], Date.now())).toBe('Selected');
    expect(sourceSelectionButtonLabel(otherCandidate, selectedSession, [], Date.now())).toBe('Locked');
  });
});

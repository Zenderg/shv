import type { Candidate, SourceSession } from './sidebarStore';

const RESUME_PLAYBACK_LABEL = 'Resume playback';

export function sourceSelectionDisabledReason(session: SourceSession, now = Date.now()) {
  if (session.playbackState === 'inactive') {
    return RESUME_PLAYBACK_LABEL;
  }
  if (typeof session.activePlaybackUntil === 'number' && session.activePlaybackUntil <= now) {
    return RESUME_PLAYBACK_LABEL;
  }
  return null;
}

export function sourceSelectionButtonLabel(candidate: Candidate, session: SourceSession, selectingUrls: string[], now = Date.now()) {
  if (session.status === 'selected') {
    return session.selectedUrl === candidate.url ? 'Selected' : 'Locked';
  }
  if (selectingUrls.includes(candidate.url)) {
    return 'Selecting...';
  }
  return sourceSelectionDisabledReason(session, now) ?? 'Use source';
}

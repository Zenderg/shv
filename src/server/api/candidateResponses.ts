import type { MediaCandidate, QueueSnapshot, SubtitleTrack } from '../../shared/types.js';

export function candidateResponses(candidates: MediaCandidate[]): MediaCandidate[] {
  return candidates.map(candidateResponse);
}

export function queueSnapshotResponse(snapshot: QueueSnapshot): QueueSnapshot {
  return {
    ...snapshot,
    candidatesByJobId: Object.fromEntries(
      Object.entries(snapshot.candidatesByJobId).map(([jobId, candidates]) => [jobId, candidateResponses(candidates)])
    )
  };
}

function candidateResponse(candidate: MediaCandidate): MediaCandidate {
  return {
    ...candidate,
    headers: {},
    subtitleTracks: candidate.subtitleTracks.map(subtitleTrackResponse)
  };
}

function subtitleTrackResponse(track: SubtitleTrack): SubtitleTrack {
  if (!track.headers) {
    return track;
  }
  const { headers: _headers, ...response } = track;
  return response;
}

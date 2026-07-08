import type { Candidate, SourceSession } from './sidebarStore';

export function visibleSidebarCandidates(session: SourceSession | null): Candidate[] {
  const candidates = session?.candidates ?? [];
  if (!session || candidates.length <= 1) {
    return candidates;
  }

  const selected = selectedCandidate(session, candidates);
  if (selected && session.status === 'selected') {
    return [selected];
  }

  const activeUrl = session.activePlaybackMetadata?.currentSrc ?? null;
  const exactPlaybackMatches = activeUrl ? candidates.filter((candidate) => sameUrl(candidate.url, activeUrl)) : [];
  if (exactPlaybackMatches.length > 0) {
    return technicalRepresentatives(exactPlaybackMatches);
  }

  const activeResolution = session.activePlaybackMetadata?.resolution ?? null;
  const matchingHlsCandidates = activeResolution
    ? candidates.filter((candidate) => isHlsCandidate(candidate) && candidate.resolution === activeResolution)
    : [];
  if (matchingHlsCandidates.length > 0) {
    return technicalRepresentatives(matchingHlsCandidates);
  }

  return technicalRepresentatives(candidates);
}

function selectedCandidate(session: SourceSession, candidates: Candidate[]) {
  return session.selectedUrl ? candidates.find((candidate) => candidate.url === session.selectedUrl) ?? null : null;
}

function technicalRepresentatives(candidates: Candidate[]) {
  const entries: Array<{ candidate: Candidate; kind: 'candidate' } | { key: string; kind: 'hls' }> = [];
  const hlsByResolution = new Map<string, Candidate[]>();

  for (const candidate of candidates) {
    if (!isHlsCandidate(candidate)) {
      entries.push({ candidate, kind: 'candidate' });
      continue;
    }
    const key = hlsGroupKey(candidate);
    if (!hlsByResolution.has(key)) {
      entries.push({ key, kind: 'hls' });
      hlsByResolution.set(key, []);
    }
    hlsByResolution.get(key)?.push(candidate);
  }

  return entries.map((entry) => (entry.kind === 'candidate' ? entry.candidate : preferredHlsCandidate(hlsByResolution.get(entry.key) ?? [])));
}

function preferredHlsCandidate(candidates: Candidate[]) {
  return [...candidates].sort((left, right) => {
    const concretenessDelta = Number(isConcreteHlsPlaylist(right)) - Number(isConcreteHlsPlaylist(left));
    if (concretenessDelta !== 0) {
      return concretenessDelta;
    }
    return compareCandidates(left, right);
  })[0];
}

function compareCandidates(left: Candidate, right: Candidate) {
  const confidenceDelta = right.confidence - left.confidence;
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }
  return left.url.localeCompare(right.url);
}

function isHlsCandidate(candidate: Candidate) {
  return candidate.manifestType === 'hls' || candidate.contentType?.includes('mpegurl') || pathname(candidate.url).endsWith('.m3u8');
}

function isConcreteHlsPlaylist(candidate: Candidate) {
  const path = pathname(candidate.url);
  return path.endsWith('.m3u8') && !path.endsWith('/master.m3u8') && !path.endsWith('/master.m3u');
}

function hlsGroupKey(candidate: Candidate) {
  const path = pathname(candidate.url);
  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  return `${origin(candidate.url)}${directory}\n${candidate.resolution ?? 'unknown'}`;
}

function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function pathname(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function sameUrl(left: string, right: string) {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
}

import { useEffect, useMemo, useState } from 'react';
import { TrashIcon } from '../../components/icons';
import type { DownloadJob, MediaCandidate, SubtitleTrack } from '../../lib/api';
import { jobStageProgress } from '../../lib/jobProgress';

export function QueuePanel({
  busyJobIds,
  candidatesByJobId,
  jobs,
  onCancel,
  onDelete,
  onManual,
  onRetry,
  onSubtitleNext
}: {
  busyJobIds: Record<string, string>;
  candidatesByJobId: Record<string, MediaCandidate[]>;
  jobs: DownloadJob[];
  onCancel: (job: DownloadJob) => void;
  onDelete: (job: DownloadJob) => void;
  onManual: (job: DownloadJob) => void;
  onRetry: (job: DownloadJob) => void;
  onSubtitleNext: (job: DownloadJob, subtitleTrackUrl: string | null) => void;
}) {
  return (
    <section className="queueList" aria-label="Queue jobs">
      {jobs.length === 0 ? <p className="muted">No jobs in queue.</p> : null}
      {jobs.map((job) => {
        const stage = jobStageProgress(job);
        const canCancel = ['pending', 'analyzing', 'downloading', 'processing'].includes(job.status);
        const canRetry = job.status === 'failed' || job.status === 'canceled';
        const actionLabel = busyJobIds[job.id];
        const actionBusy = Boolean(actionLabel);
        const selectedCandidate = (candidatesByJobId[job.id] ?? []).find((candidate) => candidate.id === job.selectedCandidateId) ?? null;
        return (
          <article className={`queueJob ${job.status}`} key={job.id}>
            <div className="jobHeader">
              <strong>{job.titleHint || new URL(job.sourceUrl).hostname}</strong>
              <span>{job.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="progressStack">
              <ProgressRow label="Overall" value={job.progress} />
              <ProgressRow label={stage.label} value={stage.value} />
            </div>
            {job.errorMessage ? <p>{job.errorMessage}</p> : null}
            {job.status === 'needs_subtitle_selection' ? (
              <SubtitleSelection
                actionBusy={actionBusy}
                actionLabel={actionLabel}
                candidate={selectedCandidate}
                onNext={(subtitleTrackUrl) => onSubtitleNext(job, subtitleTrackUrl)}
              />
            ) : null}
            <div className="jobActions">
              {job.status === 'needs_manual_selection' || job.status === 'failed' ? (
                <button disabled={actionBusy} onClick={() => onManual(job)} type="button">
                  {actionLabel ?? 'Choose source'}
                </button>
              ) : null}
              {canRetry ? (
                <button disabled={actionBusy} onClick={() => onRetry(job)} type="button">
                  {actionLabel ?? 'Retry'}
                </button>
              ) : null}
              {canCancel ? (
                <button disabled={actionBusy} onClick={() => onCancel(job)} type="button">
                  {actionLabel ?? 'Cancel'}
                </button>
              ) : null}
              <button
                className="dangerButton"
                disabled={actionBusy || canCancel}
                onClick={() => onDelete(job)}
                title={canCancel ? 'Cancel the running job before deleting it' : 'Delete from queue'}
                type="button"
              >
                <TrashIcon />
                {actionLabel ?? 'Delete'}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function SubtitleSelection({
  actionBusy,
  actionLabel,
  candidate,
  onNext
}: {
  actionBusy: boolean;
  actionLabel?: string;
  candidate: MediaCandidate | null;
  onNext: (subtitleTrackUrl: string | null) => void;
}) {
  const tracks = useMemo(() => supportedSubtitleTracks(candidate), [candidate]);
  const [choice, setChoice] = useState('none');

  useEffect(() => {
    setChoice('none');
  }, [candidate?.id]);

  return (
    <section className="subtitleSelection" aria-label="Subtitle selection">
      <label>
        Subtitle track
        <select disabled={actionBusy || tracks.length === 0} onChange={(event) => setChoice(event.target.value)} value={choice}>
          <option value="none">No subtitles</option>
          {tracks.map((track) => (
            <option key={track.url} value={track.url}>
              {subtitleTrackLabel(track)}
            </option>
          ))}
        </select>
      </label>
      <button disabled={actionBusy || !candidate} onClick={() => onNext(choice === 'none' ? null : choice)} type="button">
        {actionLabel ?? 'Next'}
      </button>
    </section>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  const normalized = clamp01(value);
  return (
    <div className="progressRow">
      <div>
        <span>{label}</span>
        <strong>{formatProgressPercent(normalized)}</strong>
      </div>
      <progress max={1} value={normalized} />
    </div>
  );
}

function supportedSubtitleTracks(candidate: MediaCandidate | null): SubtitleTrack[] {
  return (candidate?.subtitleTracks ?? []).filter((track) => ['webvtt', 'srt', 'ass', 'hls'].includes(track.format));
}

function subtitleTrackLabel(track: SubtitleTrack): string {
  const label = track.label ?? languageLabel(track.language) ?? subtitleFilenameLabel(track.url) ?? track.format;
  return track.format === 'unknown' ? label : `${label} (${track.format.toUpperCase()})`;
}

function languageLabel(language: string | null): string | null {
  if (language === 'ru' || language === 'rus') {
    return 'Russian';
  }
  if (language === 'en' || language === 'eng') {
    return 'English';
  }
  return language;
}

function subtitleFilenameLabel(url: string): string | null {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return filename.replace(/\.[a-z0-9]+$/i, '') || null;
  } catch {
    return null;
  }
}

function formatProgressPercent(value: number): string {
  const percent = clamp01(value) * 100;
  if (percent > 0 && percent < 0.1) {
    return '<0.1%';
  }
  if (percent > 0 && percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

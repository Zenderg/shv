import { useEffect, useMemo, useState } from 'react';
import { TrashIcon } from '../../components/icons';
import type { Category, DownloadJob, MediaCandidate, SubtitleTrack } from '../../lib/api';
import { formatProgressPercent, jobStageProgress } from '../../lib/jobProgress';
import { jobProgressContext, queuePositionByJobId } from './queueCardContext';
import { queueJobPresentation, type QueueStatusIcon } from './queuePresentation';

export interface QueuePanelProps {
  actionErrors?: Record<string, string>;
  busyJobIds: Record<string, string>;
  candidatesByJobId: Record<string, MediaCandidate[]>;
  categories: Category[];
  jobs: DownloadJob[];
  onCancel: (job: DownloadJob) => void;
  onDelete: (job: DownloadJob) => void;
  onManual: (job: DownloadJob) => void;
  onRetry: (job: DownloadJob) => void;
  onSubtitleNext: (job: DownloadJob, subtitleTrackUrl: string | null) => void;
  sourceTabOpenedJobIds?: Record<string, boolean>;
}

export function QueuePanel({
  actionErrors = {},
  busyJobIds,
  candidatesByJobId,
  categories,
  jobs,
  onCancel,
  onDelete,
  onManual,
  onRetry,
  onSubtitleNext,
  sourceTabOpenedJobIds = {}
}: QueuePanelProps) {
  const categoryNames = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, category.name])), [categories]);
  const pendingPositions = useMemo(() => queuePositionByJobId(jobs), [jobs]);

  return (
    <section className="queueList" aria-label="Queue jobs">
      {jobs.length === 0 ? <p className="queueEmpty muted">No jobs in queue.</p> : null}
      {jobs.map((job) => {
        const sourceTabOpened = Boolean(sourceTabOpenedJobIds[job.id]);
        const presentation = queueJobPresentation({ ...job, sourceTabOpened });
        const canCancel = ['pending', 'analyzing', 'downloading', 'processing', 'adding_subtitles'].includes(job.status);
        const canRetry = job.status === 'failed' || job.status === 'canceled';
        const actionLabel = busyJobIds[job.id];
        const actionBusy = Boolean(actionLabel);
        const candidates = candidatesByJobId[job.id] ?? [];
        const selectedCandidate = candidates.find((candidate) => candidate.id === job.selectedCandidateId) ?? null;
        const title = job.titleHint || safeHostname(job.sourceUrl);
        const titleId = `queue-job-${job.id}-title`;

        return (
          <article
            aria-labelledby={titleId}
            className={`queueJob ${job.status}`}
            data-tone={presentation.tone}
            key={job.id}
          >
            <header className="jobHeader">
              <h2 className="jobTitle" id={titleId}>{title}</h2>
              <span aria-live="polite" className="jobStatus" data-tone={presentation.tone} role="status">
                <StatusIcon kind={presentation.icon} />
                {presentation.label}
              </span>
            </header>

            <dl className="jobContext">
              <div>
                <dt>Destination</dt>
                <dd>{categoryNames[job.categoryId] ?? 'Unknown category'}</dd>
              </div>
              {job.status === 'pending' ? (
                <div>
                  <dt>Queue</dt>
                  <dd>{jobProgressContext(job.status, pendingPositions[job.id])}</dd>
                </div>
              ) : null}
            </dl>

            {presentation.showProgress ? <JobProgress job={job} title={title} /> : null}

            {presentation.notice ? (
              <JobNotice
                detail={presentation.notice.detail}
                summary={presentation.notice.summary}
                technicalDetails={job.errorMessage}
                tone={presentation.tone}
              />
            ) : null}

            {job.status === 'needs_subtitle_selection' ? (
              <SubtitleSelection
                actionBusy={actionBusy}
                candidate={selectedCandidate}
                onNext={(subtitleTrackUrl) => onSubtitleNext(job, subtitleTrackUrl)}
              />
            ) : null}

            {actionBusy ? <p className="jobActionStatus" role="status">{actionLabel}…</p> : null}
            {actionErrors[job.id] ? <p className="jobActionError" role="alert">{actionErrors[job.id]}</p> : null}

            <div className="jobActions">
              {canRetry ? (
                <button className="queuePrimaryAction" disabled={actionBusy} onClick={() => onRetry(job)} type="button">
                  Retry
                </button>
              ) : null}
              {job.status === 'needs_manual_selection' ? (
                <button className="queuePrimaryAction" disabled={actionBusy} onClick={() => onManual(job)} type="button">
                  {sourceTabOpened ? 'Reopen source tab' : 'Choose source'}
                </button>
              ) : null}
              {job.status === 'failed' ? (
                <button className="queueSecondaryAction" disabled={actionBusy} onClick={() => onManual(job)} type="button">
                  Choose another source
                </button>
              ) : null}
              {canCancel ? (
                <button className="queueSecondaryAction" disabled={actionBusy} onClick={() => onCancel(job)} type="button">
                  Cancel
                </button>
              ) : null}
              {!canCancel ? (
                <button
                  className="dangerButton"
                  disabled={actionBusy}
                  onClick={() => onDelete(job)}
                  type="button"
                >
                  <TrashIcon />
                  Delete
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function JobProgress({ job, title }: { job: DownloadJob; title: string }) {
  const stage = jobStageProgress(job);
  return (
    <div className="progressStack">
      <ProgressRow id={`queue-job-${job.id}-stage-progress`} label={stage.label} title={title} value={stage.value} />
    </div>
  );
}

function JobNotice({
  detail,
  summary,
  technicalDetails,
  tone
}: {
  detail: string;
  summary: string;
  technicalDetails: string | null;
  tone: 'active' | 'attention' | 'danger' | 'neutral';
}) {
  return (
    <div className="jobNotice" data-tone={tone}>
      <strong>{summary}</strong>
      <p>{detail}</p>
      {technicalDetails ? (
        <details>
          <summary>Technical details</summary>
          <pre>{technicalDetails}</pre>
        </details>
      ) : null}
    </div>
  );
}

function SubtitleSelection({
  actionBusy,
  candidate,
  onNext
}: {
  actionBusy: boolean;
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
      <button className="queuePrimaryAction" disabled={actionBusy || !candidate} onClick={() => onNext(choice === 'none' ? null : choice)} type="button">
        Continue
      </button>
    </section>
  );
}

function ProgressRow({ id, label, title, value }: { id: string; label: string; title: string; value: number | null }) {
  const labelId = `${id}-label`;
  return (
    <div className="progressRow">
      <div>
        <span id={labelId}>{label}</span>
        <strong>{value === null ? 'In progress' : `${formatProgressPercent(value)} of this step`}</strong>
      </div>
      <progress aria-labelledby={`${labelId} ${id}-context`} max={1} {...(value === null ? {} : { value })} />
      <span className="queueProgressContext" id={`${id}-context`}>{title}</span>
    </div>
  );
}

function StatusIcon({ kind }: { kind: QueueStatusIcon }) {
  switch (kind) {
    case 'analyzing':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M10.5 4a6.5 6.5 0 1 0 3.9 11.7l4.9 4.9 1.4-1.4-4.9-4.9A6.5 6.5 0 0 0 10.5 4Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z" /></svg>;
    case 'download':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M11 4h2v9l3-3 1.4 1.4-5.4 5.4-5.4-5.4L8 10l3 3V4Zm-6 14h14v2H5v-2Z" /></svg>;
    case 'processing':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2.1-5l-2.4 2.4H21V3l-2.7 2.7A9 9 0 0 0 12 3Z" /></svg>;
    case 'subtitles':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M3 5h18v14H3V5Zm2 2v10h14V7H5Zm1.5 6h5v2h-5v-2Zm6.5 0h4.5v2H13v-2ZM6.5 9h3v2h-3V9Zm4.5 0h6.5v2H11V9Z" /></svg>;
    case 'error':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3 1.8 20h20.4L12 3Zm0 4 6.7 11H5.3L12 7Zm-1 3v4h2v-4h-2Zm0 5.5v2h2v-2h-2Z" /></svg>;
    case 'canceled':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 0 1 5.1 11.8L7.2 6.9A7 7 0 0 1 12 5Zm-6.2 3.3 9.9 9.9A7 7 0 0 1 5.8 8.3Z" /></svg>;
    case 'waiting':
      return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 2a7 7 0 1 1-7 7 7 7 0 0 1 7-7Zm-1 2v6h5v-2h-3V7h-2Z" /></svg>;
  }
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

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname || 'Untitled job';
  } catch {
    return 'Untitled job';
  }
}

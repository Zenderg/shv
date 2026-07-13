import { PlusIcon, UpdateIcon } from './icons';
import { queueCountsLabel, type QueueCounts } from '../features/queue/queueSummary';

export function AppHeader({
  activeProblems,
  busy,
  categoryName,
  extensionUpdateAvailable,
  loading,
  mediaCount,
  onAdd,
  onUpdateExtension,
  page,
  queueCounts
}: {
  activeProblems: number;
  busy: boolean;
  categoryName: string | null;
  extensionUpdateAvailable: boolean;
  loading: boolean;
  mediaCount: number;
  onAdd: () => void;
  onUpdateExtension: () => void;
  page: 'library' | 'queue';
  queueCounts: QueueCounts;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{page === 'queue' ? 'Queue' : categoryName ?? 'Library'}</h1>
        <p>
          {loading
            ? page === 'queue' ? 'Loading queue…' : 'Loading videos…'
            : page === 'queue'
            ? queueCountsLabel(queueCounts)
            : `${mediaCount} saved videos${activeProblems ? `, ${activeProblems} need attention` : ''}`}
        </p>
      </div>
      <div className="topbarActions">
        {extensionUpdateAvailable ? (
          <button className="extensionUpdateButton" onClick={onUpdateExtension} type="button">
            <UpdateIcon />
            Update extension
          </button>
        ) : null}
        <button className="primaryButton" disabled={busy} onClick={onAdd} type="button">
          <PlusIcon />
          Add
        </button>
      </div>
    </header>
  );
}

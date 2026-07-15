import { PlusIcon, UpdateIcon } from './icons';
import { queueCountsLabel, type QueueCounts } from '../features/queue/queueSummary';

export function AppHeader({
  busy,
  categoryName,
  extensionUpdateAvailable,
  loading,
  librarySummary,
  onAdd,
  onUpdateExtension,
  page,
  queueCounts
}: {
  busy: boolean;
  categoryName: string | null;
  extensionUpdateAvailable: boolean;
  loading: boolean;
  librarySummary: string;
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
            : librarySummary}
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

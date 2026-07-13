import { PlusIcon, UpdateIcon } from './icons';

export function AppHeader({
  activeProblems,
  busy,
  categoryName,
  categoryCount,
  extensionUpdateAvailable,
  loading,
  mediaCount,
  onAdd,
  onUpdateExtension,
  page
}: {
  activeProblems: number;
  busy: boolean;
  categoryName: string | null;
  categoryCount: number;
  extensionUpdateAvailable: boolean;
  loading: boolean;
  mediaCount: number;
  onAdd: () => void;
  onUpdateExtension: () => void;
  page: 'library' | 'queue';
}) {
  return (
    <header className="topbar">
      <div>
        <h1>{page === 'queue' ? 'Queue' : categoryName ?? 'Library'}</h1>
        <p>
          {loading
            ? page === 'queue' ? 'Loading queue…' : 'Loading videos…'
            : page === 'queue'
            ? `${categoryCount} current ${categoryCount === 1 ? 'job' : 'jobs'}${activeProblems ? `, ${activeProblems} need attention` : ''}`
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

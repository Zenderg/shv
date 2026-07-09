import { PlusIcon } from './icons';

export function AppHeader({
  activeProblems,
  busy,
  categoryName,
  categoryCount,
  loading,
  mediaCount,
  onAdd,
  page
}: {
  activeProblems: number;
  busy: boolean;
  categoryName: string | null;
  categoryCount: number;
  loading: boolean;
  mediaCount: number;
  onAdd: () => void;
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
        <button className="primaryButton" disabled={busy} onClick={onAdd} type="button">
          <PlusIcon />
          Add
        </button>
      </div>
    </header>
  );
}

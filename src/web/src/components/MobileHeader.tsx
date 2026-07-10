import * as Dialog from '@radix-ui/react-dialog';
import { MenuIcon, PlusIcon } from './icons';

export function MobileHeader({
  activeProblems,
  addDisabled = false,
  categoryName,
  onAdd,
  page,
  queueBadgeCount
}: {
  activeProblems: number;
  addDisabled?: boolean;
  categoryName: string | null;
  onAdd: () => void;
  page: 'library' | 'queue';
  queueBadgeCount: number;
}) {
  return (
    <header className="mobileHeader">
      <Dialog.Trigger asChild>
        <button aria-label="Open navigation" className="mobileHeaderIconButton" type="button">
          <MenuIcon />
        </button>
      </Dialog.Trigger>
      <div className="mobileHeaderTitle">
        <strong>{page === 'queue' ? 'Queue' : categoryName ?? 'Library'}</strong>
        <span>
          {queueBadgeCount} queued{activeProblems ? `, ${activeProblems} need attention` : ''}
        </span>
      </div>
      <button className="mobileAddButton" disabled={addDisabled} onClick={onAdd} type="button">
        <PlusIcon />
        <span>Add</span>
      </button>
    </header>
  );
}

import * as Dialog from '@radix-ui/react-dialog';
import { MenuIcon, PlusIcon, UpdateIcon } from './icons';

export function MobileHeader({
  activeProblems,
  addDisabled = false,
  categoryName,
  extensionUpdateAvailable,
  onAdd,
  onUpdateExtension,
  page,
  queueBadgeCount
}: {
  activeProblems: number;
  addDisabled?: boolean;
  categoryName: string | null;
  extensionUpdateAvailable: boolean;
  onAdd: () => void;
  onUpdateExtension: () => void;
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
      <div className="mobileHeaderActions">
        {extensionUpdateAvailable ? (
          <button
            aria-label="Update browser extension"
            className="mobileExtensionUpdateButton"
            onClick={onUpdateExtension}
            title="Update browser extension"
            type="button"
          >
            <UpdateIcon />
          </button>
        ) : null}
        <button className="mobileAddButton" disabled={addDisabled} onClick={onAdd} type="button">
          <PlusIcon />
          <span>Add</span>
        </button>
      </div>
    </header>
  );
}

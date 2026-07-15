import * as Dialog from '@radix-ui/react-dialog';
import { MenuIcon, PlusIcon, UpdateIcon } from './icons';

export function MobileHeader({
  addDisabled = false,
  categoryName,
  extensionUpdateAvailable,
  librarySummary,
  onAdd,
  onUpdateExtension,
  page,
  queueSummary
}: {
  addDisabled?: boolean;
  categoryName: string | null;
  extensionUpdateAvailable: boolean;
  librarySummary: string;
  onAdd: () => void;
  onUpdateExtension: () => void;
  page: 'library' | 'queue';
  queueSummary: string;
}) {
  return (
    <header className="mobileHeader">
      <Dialog.Trigger asChild>
        <button aria-label="Open navigation" className="mobileHeaderIconButton" type="button">
          <MenuIcon />
        </button>
      </Dialog.Trigger>
      <div className="mobileHeaderTitle">
        <h1>{page === 'queue' ? 'Queue' : categoryName ?? 'Library'}</h1>
        <span>
          {page === 'queue' ? queueSummary : librarySummary}
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

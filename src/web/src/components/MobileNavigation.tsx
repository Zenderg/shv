import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { Category } from '../lib/api';
import { CategoryActionsMenu } from './CategoryActionsMenu';
import { MobileHeader } from './MobileHeader';
import { CloseIcon, Mark, PlusIcon, QueueIcon } from './icons';

export interface MobileNavigationProps {
  activeProblems: number;
  addDisabled?: boolean;
  categories: Category[];
  extensionUpdateAvailable: boolean;
  onAdd: () => void;
  onChooseCategory: (categoryId: string) => void;
  onCreateCategory: () => void;
  onDeleteCategory: (category: Category) => void;
  onRenameCategory: (category: Category) => void;
  onShowQueue: () => void;
  onUpdateExtension: () => void;
  page: 'library' | 'queue';
  queueItemCount: number;
  queueSummary: string;
  selectedCategoryId: string;
}

export function MobileNavigation({
  activeProblems,
  addDisabled,
  categories,
  extensionUpdateAvailable,
  onAdd,
  onChooseCategory,
  onCreateCategory,
  onDeleteCategory,
  onRenameCategory,
  onShowQueue,
  onUpdateExtension,
  page,
  queueItemCount,
  queueSummary,
  selectedCategoryId
}: MobileNavigationProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;

  function closeAndRun(action: () => void) {
    setDrawerOpen(false);
    action();
  }

  return (
    <Dialog.Root onOpenChange={setDrawerOpen} open={drawerOpen}>
      <div className="mobileNavigation">
        <MobileHeader
          addDisabled={addDisabled ?? categories.length === 0}
          categoryName={selectedCategory?.name ?? null}
          extensionUpdateAvailable={extensionUpdateAvailable}
          onAdd={onAdd}
          onUpdateExtension={onUpdateExtension}
          page={page}
          queueSummary={queueSummary}
        />
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="mobileDrawerOverlay" />
        <Dialog.Content aria-modal="true" className="mobileDrawer">
          <div className="mobileDrawerHeader">
            <div className="mobileDrawerBrand">
              <Mark />
              <div>
                <Dialog.Title>Navigation</Dialog.Title>
                <Dialog.Description>shv v{__APP_VERSION__} · Choose a queue or library destination.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close navigation" className="mobileDrawerClose" type="button">
                <CloseIcon />
              </button>
            </Dialog.Close>
          </div>

          <nav className="mobileDrawerBody" aria-label="Mobile navigation">
            <button
              aria-label={`Queue, ${queueSummary}`}
              aria-current={page === 'queue' ? 'page' : undefined}
              className={page === 'queue' ? 'mobileQueueShortcut selected' : 'mobileQueueShortcut'}
              onClick={() => closeAndRun(onShowQueue)}
              type="button"
            >
              <QueueIcon />
              <span>
                <strong>Queue</strong>
                <small>{activeProblems ? `${activeProblems} need attention` : 'No jobs need attention'}</small>
              </span>
              <strong aria-hidden="true" className="navBadge">{queueItemCount}</strong>
            </button>

            <section className="mobileCategorySection">
              <div className="mobileCategoryHeader">
                <span>Library</span>
                <button onClick={() => closeAndRun(onCreateCategory)} type="button">
                  <PlusIcon />
                  New category
                </button>
              </div>

              <label className="mobileCategorySelect">
                <span>Category</span>
                <select
                  onChange={(event) => {
                    const categoryId = event.target.value;
                    if (categoryId) {
                      closeAndRun(() => onChooseCategory(categoryId));
                    }
                  }}
                  value={page === 'library' ? selectedCategoryId : ''}
                >
                  <option disabled value="">
                    {categories.length === 0 ? 'No categories' : 'Choose category'}
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              {selectedCategory ? (
                <div className="mobileSelectedCategory">
                  <div>
                    <span>Selected category</span>
                    <strong>{selectedCategory.name}</strong>
                  </div>
                  <CategoryActionsMenu
                    category={selectedCategory}
                    onDelete={(category) => closeAndRun(() => onDeleteCategory(category))}
                    onRename={(category) => closeAndRun(() => onRenameCategory(category))}
                    triggerClassName="mobileCategoryMenuButton"
                  />
                </div>
              ) : null}
            </section>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

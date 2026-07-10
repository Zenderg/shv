import type { Category } from '../lib/api';
import { CategoryActionsMenu } from './CategoryActionsMenu';
import { FolderIcon, Mark, PlusIcon, QueueIcon } from './icons';

export function AppSidebar({
  categories,
  onChooseCategory,
  onCreateCategory,
  onDeleteCategory,
  onOpenCategoryMenuChange,
  onRenameCategory,
  onShowQueue,
  openCategoryMenuId,
  page,
  queueBadgeCount,
  selectedCategoryId
}: {
  categories: Category[];
  onChooseCategory: (categoryId: string) => void;
  onCreateCategory: () => void;
  onDeleteCategory: (category: Category) => void;
  onOpenCategoryMenuChange: (categoryId: string | null) => void;
  onRenameCategory: (category: Category) => void;
  onShowQueue: () => void;
  openCategoryMenuId: string | null;
  page: 'library' | 'queue';
  queueBadgeCount: number;
  selectedCategoryId: string;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <div>
          <strong>shv</strong>
          <span>local library</span>
        </div>
      </div>

      <nav className="queueNav" aria-label="Queue">
        <button
          aria-current={page === 'queue' ? 'page' : undefined}
          className={page === 'queue' ? 'selected' : ''}
          onClick={onShowQueue}
          type="button"
        >
          <QueueIcon />
          <span>Queue</span>
          <strong className="navBadge">{queueBadgeCount}</strong>
        </button>
      </nav>

      <div className="categorySection">
        <div className="categoryHeader">
          <span>Categories</span>
          <button aria-label="Create category" onClick={onCreateCategory} type="button">
            <PlusIcon />
          </button>
        </div>
        <nav className="categoryNav" aria-label="Categories">
          {categories.map((category) => (
            <div
              className={page === 'library' && category.id === selectedCategoryId ? 'categoryNavItem selected' : 'categoryNavItem'}
              data-category-menu-root={category.id}
              key={category.id}
            >
              <button
                aria-current={page === 'library' && category.id === selectedCategoryId ? 'page' : undefined}
                className="categoryLink"
                onClick={() => {
                  onOpenCategoryMenuChange(null);
                  onChooseCategory(category.id);
                }}
                type="button"
              >
                <FolderIcon />
                <span>{category.name}</span>
              </button>
              <CategoryActionsMenu
                category={category}
                onDelete={onDeleteCategory}
                onOpenChange={(open) => onOpenCategoryMenuChange(open ? category.id : null)}
                onRename={onRenameCategory}
                open={openCategoryMenuId === category.id}
              />
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

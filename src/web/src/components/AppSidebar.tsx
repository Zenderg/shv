import type { Category } from '../lib/api';
import { EllipsisIcon, FolderIcon, Mark, PlusIcon, QueueIcon } from './icons';

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
        <button className={page === 'queue' ? 'selected' : ''} onClick={onShowQueue} type="button">
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
              <button
                aria-expanded={openCategoryMenuId === category.id}
                aria-haspopup="menu"
                aria-label={`Open menu for ${category.name}`}
                className="categoryMenuButton"
                onClick={() => onOpenCategoryMenuChange(openCategoryMenuId === category.id ? null : category.id)}
                type="button"
              >
                <EllipsisIcon />
              </button>
              {openCategoryMenuId === category.id ? (
                <div className="categoryMenu" role="menu">
                  <button
                    onClick={() => {
                      onOpenCategoryMenuChange(null);
                      onRenameCategory(category);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    className="dangerMenuItem"
                    onClick={() => {
                      onOpenCategoryMenuChange(null);
                      onDeleteCategory(category);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

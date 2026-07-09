import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { Category } from '../lib/api';
import { EllipsisIcon } from './icons';

export function CategoryActionsMenu({
  category,
  onDelete,
  onOpenChange,
  onRename,
  open,
  triggerClassName = 'categoryMenuButton'
}: {
  category: Category;
  onDelete: (category: Category) => void;
  onOpenChange?: (open: boolean) => void;
  onRename: (category: Category) => void;
  open?: boolean;
  triggerClassName?: string;
}) {
  return (
    <DropdownMenu.Root onOpenChange={onOpenChange} open={open}>
      <DropdownMenu.Trigger asChild>
        <button aria-label={`Open menu for ${category.name}`} className={triggerClassName} type="button">
          <EllipsisIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="categoryMenu"
          data-category-menu-root={category.id}
          sideOffset={4}
        >
          <DropdownMenu.Item className="categoryMenuItem" onSelect={() => onRename(category)}>
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className="categoryMenuItem dangerMenuItem" onSelect={() => onDelete(category)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

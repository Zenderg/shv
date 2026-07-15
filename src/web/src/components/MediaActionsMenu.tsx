import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { MediaItem } from '../lib/api';
import { EllipsisIcon } from './icons';

export function MediaActionsMenu({
  item,
  onDelete,
  onEdit
}: {
  item: MediaItem;
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`Open actions for ${item.title}`}
          className="mediaActionsButton"
          title="Video actions"
          type="button"
        >
          <EllipsisIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="actionsMenu" sideOffset={4}>
          <DropdownMenu.Item className="actionsMenuItem" onSelect={() => onEdit(item)}>
            Edit video
          </DropdownMenu.Item>
          <DropdownMenu.Item className="actionsMenuItem dangerMenuItem" onSelect={() => onDelete(item)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

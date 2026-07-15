# Shared UI Components

This file is generated design context for Superdesign. It contains the full implementation of the reusable React primitives used by the production web UI. Page-specific library, queue, and dialog components belong in `pages.md` dependency trees rather than this primitive inventory.

## AsyncStates.tsx

- Path: `src/web/src/components/AsyncStates.tsx`
- Purpose: Shared loading, notice, and error-state primitives.

```tsx
import type { ReactNode } from 'react';

export function InlineNotice({
  action,
  children,
  tone = 'warning'
}: {
  action?: ReactNode;
  children: ReactNode;
  tone?: 'danger' | 'warning';
}) {
  return (
    <div className="inlineNotice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function PageLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="loadErrorState" role="alert">
      <h2>Couldn’t load this view</h2>
      <p>{message}</p>
      <button className="primaryButton" onClick={onRetry} type="button">
        Try again
      </button>
    </section>
  );
}

export function LibrarySkeleton() {
  return (
    <section aria-label="Loading videos" aria-live="polite" className="libraryGrid skeletonGrid">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div aria-hidden="true" className="skeletonCard" key={item}>
          <span className="skeletonPoster" />
          <span className="skeletonLine wide" />
          <span className="skeletonLine" />
        </div>
      ))}
      <span className="srOnly">Loading videos…</span>
    </section>
  );
}

export function QueueSkeleton() {
  return (
    <section aria-label="Loading queue" aria-live="polite" className="queueList skeletonQueue">
      {[0, 1, 2].map((item) => (
        <div aria-hidden="true" className="skeletonQueueCard" key={item}>
          <span className="skeletonLine wide" />
          <span className="skeletonLine" />
          <span className="skeletonBar" />
        </div>
      ))}
      <span className="srOnly">Loading queue…</span>
    </section>
  );
}
```

## DialogBackdrop.tsx

- Path: `src/web/src/components/DialogBackdrop.tsx`
- Purpose: Radix-based modal backdrop, focus trap, and focus restoration wrapper.

```tsx
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';

export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;

export function DialogBackdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialogBackdrop">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            aria-modal="true"
            asChild
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocusRef.current?.focus({ preventScroll: true });
            }}
            onOpenAutoFocus={(event) => {
              const content = event.currentTarget as HTMLElement;
              const initialFocus = content.querySelector<HTMLElement>('[data-dialog-initial-focus]');
              if (!initialFocus) {
                return;
              }
              event.preventDefault();
              initialFocus.focus({ preventScroll: true });
            }}
          >
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

## CategoryActionsMenu.tsx

- Path: `src/web/src/components/CategoryActionsMenu.tsx`
- Purpose: Reusable category overflow menu.

```tsx
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
          className="actionsMenu"
          data-category-menu-root={category.id}
          sideOffset={4}
        >
          <DropdownMenu.Item className="actionsMenuItem" onSelect={() => onRename(category)}>
            Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className="actionsMenuItem dangerMenuItem" onSelect={() => onDelete(category)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

## MediaActionsMenu.tsx

- Path: `src/web/src/components/MediaActionsMenu.tsx`
- Purpose: Reusable video-card overflow menu.

```tsx
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
            Rename or move
          </DropdownMenu.Item>
          <DropdownMenu.Item className="actionsMenuItem dangerMenuItem" onSelect={() => onDelete(item)}>
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

## icons.tsx

- Path: `src/web/src/components/icons.tsx`
- Purpose: Project-owned SVG icon primitives and brand mark.

```tsx
export function Mark() {
  return <svg viewBox="0 0 32 32"><path d="M4 9a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Zm10 2v10l8-5-8-5Z" /></svg>;
}

export function QueueIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 5h14v2H5V5Zm0 6h14v2H5v-2Zm0 6h10v2H5v-2Z" /></svg>;
}

export function MenuIcon() {
  return <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" /></svg>;
}

export function FolderIcon() {
  return <svg viewBox="0 0 24 24"><path d="M3 6.8A2.8 2.8 0 0 1 5.8 4h4l2 2.2h6.4A2.8 2.8 0 0 1 21 9v8.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2V6.8Z" /></svg>;
}

export function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.8-6.2c.6-.4.6-1.4 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z" /></svg>;
}

export function PlusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>;
}

export function UpdateIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 4a8 8 0 0 1 7.5 5.2l-1.9.7A6 6 0 0 0 7.2 8H10v2H4V4h2v2.3A8 8 0 0 1 12 4Zm8 10v6h-2v-2.3A8 8 0 0 1 4.5 14.8l1.9-.7A6 6 0 0 0 16.8 16H14v-2h6Z" /></svg>;
}

export function EditIcon() {
  return <svg viewBox="0 0 24 24"><path d="m5 16.8-.8 3 3-.8L18.7 7.5l-2.2-2.2L5 16.8Zm13.9-13.9 2.2 2.2-1.2 1.2-2.2-2.2 1.2-1.2Z" /></svg>;
}

export function TrashIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v8H9v-8Zm4 0h2v8h-2v-8ZM6 10h12l-.8 10H6.8L6 10Z" /></svg>;
}

export function EllipsisIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" /></svg>;
}

export function CloseIcon() {
  return <svg viewBox="0 0 24 24"><path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" /></svg>;
}
```

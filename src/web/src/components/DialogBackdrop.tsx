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

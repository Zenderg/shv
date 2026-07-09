import type { ReactNode } from 'react';

export function DialogBackdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="dialogBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

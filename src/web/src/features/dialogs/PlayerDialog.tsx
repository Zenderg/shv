import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { MediaItem } from '../../lib/api';

export function PlayerDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="playerDialog">
        <header>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogClose asChild>
            <button aria-label={`Close ${item.title}`} type="button">
              <CloseIcon />
            </button>
          </DialogClose>
        </header>
        <video controls data-dialog-initial-focus src={`/media/${item.id}`} tabIndex={0} />
      </section>
    </DialogBackdrop>
  );
}

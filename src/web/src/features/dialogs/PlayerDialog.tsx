import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { MediaItem } from '../../lib/api';

export function PlayerDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="playerDialog">
        <header>
          <h2>{item.title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <video controls src={`/media/${item.id}`} />
      </section>
    </DialogBackdrop>
  );
}

import { useState } from 'react';
import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { Category, MediaItem } from '../../lib/api';

export function EditDialog({
  busy,
  categories,
  error,
  item,
  onClose,
  onSave
}: {
  busy: boolean;
  categories: Category[];
  error: string | null;
  item: MediaItem;
  onClose: () => void;
  onSave: (body: { title?: string; categoryId?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [categoryId, setCategoryId] = useState(item.categoryId);
  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ title, categoryId });
        }}
      >
        <header>
          <DialogTitle>Edit video</DialogTitle>
          <DialogClose asChild>
            <button aria-label="Close Edit video" disabled={busy} type="button">
              <CloseIcon />
            </button>
          </DialogClose>
        </header>
        <label>
          Title
          <input data-dialog-initial-focus onChange={(event) => setTitle(event.target.value)} value={title} />
        </label>
        <label>
          Category
          <select onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="inlineDialogError" role="alert">{error}</p> : null}
        <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </DialogBackdrop>
  );
}

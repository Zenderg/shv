import { useState } from 'react';
import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { Category, MediaItem } from '../../lib/api';

export function EditDialog({
  categories,
  item,
  onClose,
  onSave
}: {
  categories: Category[];
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
          <h2>Edit video</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Title
          <input onChange={(event) => setTitle(event.target.value)} value={title} />
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
        <button type="submit">Save</button>
      </form>
    </DialogBackdrop>
  );
}

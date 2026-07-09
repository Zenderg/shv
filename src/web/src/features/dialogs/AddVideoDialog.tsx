import { useState } from 'react';
import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon, PlusIcon } from '../../components/icons';
import type { Category } from '../../lib/api';

export function AddVideoDialog({
  busy,
  categories,
  initialCategoryId,
  onClose,
  onSubmit
}: {
  busy: boolean;
  categories: Category[];
  initialCategoryId: string;
  onClose: () => void;
  onSubmit: (input: { sourceUrl: string; categoryId: string; newCategoryName: string }) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [categoryMode, setCategoryMode] = useState<'existing' | 'new'>('existing');
  const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const canSubmit =
    sourceUrl.trim().length > 0 && (categoryMode === 'new' ? newCategoryName.trim().length > 0 : categoryId.length > 0);

  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog addVideoDialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            sourceUrl,
            categoryId: categoryMode === 'existing' ? categoryId : '',
            newCategoryName: categoryMode === 'new' ? newCategoryName : ''
          });
        }}
      >
        <header>
          <div>
            <h2>Add video</h2>
            <p>Choose an existing category or create one.</p>
          </div>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Video URL
          <input
            autoFocus
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://..."
            required
            type="url"
            value={sourceUrl}
          />
        </label>
        <div className="categoryMode" role="group" aria-label="Category mode">
          <button className={categoryMode === 'existing' ? 'selected' : ''} onClick={() => setCategoryMode('existing')} type="button">
            Existing
          </button>
          <button className={categoryMode === 'new' ? 'selected' : ''} onClick={() => setCategoryMode('new')} type="button">
            New
          </button>
        </div>
        {categoryMode === 'existing' ? (
          <label>
            Category
            <select onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            New category
            <input
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="Category name"
              required
              value={newCategoryName}
            />
          </label>
        )}
        <button disabled={busy || !canSubmit} type="submit">
          <PlusIcon />
          Add to queue
        </button>
      </form>
    </DialogBackdrop>
  );
}

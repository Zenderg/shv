import { useRef, useState } from 'react';
import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon, PlusIcon } from '../../components/icons';
import type { Category } from '../../lib/api';
import { useCategoryLabelsQuery } from '../app/queries';
import { LabelInput, type LabelInputHandle } from '../labels/LabelInput';

export function AddVideoDialog({
  busy,
  categories,
  error,
  initialCategoryId,
  onClose,
  onSubmit
}: {
  busy: boolean;
  categories: Category[];
  error: string | null;
  initialCategoryId: string;
  onClose: () => void;
  onSubmit: (input: { sourceUrl: string; categoryId: string; labels: string[]; newCategoryName: string }) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [categoryMode, setCategoryMode] = useState<'existing' | 'new'>(categories.length > 0 ? 'existing' : 'new');
  const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const labelInputRef = useRef<LabelInputHandle>(null);
  const labelsQuery = useCategoryLabelsQuery(categoryMode === 'existing' ? categoryId : '');
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
            labels: labelInputRef.current?.value() ?? labels,
            newCategoryName: categoryMode === 'new' ? newCategoryName : ''
          });
        }}
      >
        <header>
          <div>
            <DialogTitle>Add video</DialogTitle>
            <p>Choose an existing category or create one.</p>
          </div>
          <DialogClose asChild>
            <button aria-label="Close Add video" disabled={busy} type="button">
              <CloseIcon />
            </button>
          </DialogClose>
        </header>
        <label>
          Video URL
          <input
            data-dialog-initial-focus
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://..."
            required
            type="url"
            value={sourceUrl}
          />
        </label>
        <div className="categoryMode" role="group" aria-label="Category mode">
          <button
            aria-pressed={categoryMode === 'existing'}
            className={categoryMode === 'existing' ? 'selected' : ''}
            disabled={categories.length === 0}
            onClick={() => setCategoryMode('existing')}
            type="button"
          >
            Existing
          </button>
          <button
            aria-pressed={categoryMode === 'new'}
            className={categoryMode === 'new' ? 'selected' : ''}
            onClick={() => setCategoryMode('new')}
            type="button"
          >
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
        <LabelInput
          availableLabels={labelsQuery.data?.items.map((label) => label.name) ?? []}
          disabled={busy}
          labels={labels}
          onChange={setLabels}
          ref={labelInputRef}
        />
        {error ? <p className="inlineDialogError" role="alert">{error}</p> : null}
        <button disabled={busy || !canSubmit} type="submit">
          <PlusIcon />
          {busy ? 'Adding…' : 'Add to queue'}
        </button>
      </form>
    </DialogBackdrop>
  );
}

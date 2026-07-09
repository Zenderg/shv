import { useState } from 'react';
import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';

export function CategoryNameDialog({
  actionLabel,
  busy,
  error,
  initialName,
  onClose,
  onSave,
  title
}: {
  actionLabel: string;
  busy: boolean;
  error: string | null;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
  title: string;
}) {
  const [name, setName] = useState(initialName);
  const canSubmit = name.trim().length > 0;
  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            void onSave(name.trim());
          }
        }}
      >
        <header>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <button aria-label={`Close ${title}`} disabled={busy} type="button">
              <CloseIcon />
            </button>
          </DialogClose>
        </header>
        <label>
          Name
          <input data-dialog-initial-focus onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        {error ? <p className="inlineDialogError" role="alert">{error}</p> : null}
        <button disabled={busy || !canSubmit} type="submit">
          {busy ? 'Saving…' : actionLabel}
        </button>
      </form>
    </DialogBackdrop>
  );
}

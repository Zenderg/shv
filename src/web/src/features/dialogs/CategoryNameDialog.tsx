import { useState } from 'react';
import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';

export function CategoryNameDialog({
  actionLabel,
  busy,
  initialName,
  onClose,
  onSave,
  title
}: {
  actionLabel: string;
  busy: boolean;
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
          <h2>{title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Name
          <input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={busy || !canSubmit} type="submit">
          {actionLabel}
        </button>
      </form>
    </DialogBackdrop>
  );
}

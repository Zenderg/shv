import { DialogBackdrop } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';

export function ConfirmDialog({
  actionLabel,
  busy,
  danger,
  message,
  onClose,
  onConfirm,
  title
}: {
  actionLabel: string;
  busy: boolean;
  danger?: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
}) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="formDialog confirmDialog">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <p>{message}</p>
        <div className="dialogActions">
          <button className="secondaryButton" onClick={onClose} type="button">
            Cancel
          </button>
          <button className={danger ? 'dangerButton' : ''} disabled={busy} onClick={() => void onConfirm()} type="button">
            {actionLabel}
          </button>
        </div>
      </section>
    </DialogBackdrop>
  );
}

import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';

export function ConfirmDialog({
  actionLabel,
  busy,
  danger,
  error,
  message,
  onClose,
  onConfirm,
  title
}: {
  actionLabel: string;
  busy: boolean;
  danger?: boolean;
  error: string | null;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
}) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="formDialog confirmDialog">
        <header>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <button aria-label={`Close ${title}`} disabled={busy} type="button">
              <CloseIcon />
            </button>
          </DialogClose>
        </header>
        <p>{message}</p>
        {error ? <p className="inlineDialogError" role="alert">{error}</p> : null}
        <div className="dialogActions">
          <DialogClose asChild>
            <button className="secondaryButton" data-dialog-initial-focus disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button className={danger ? 'dangerButton' : ''} disabled={busy} onClick={() => void onConfirm()} type="button">
            {busy ? `${actionLabel}…` : actionLabel}
          </button>
        </div>
      </section>
    </DialogBackdrop>
  );
}

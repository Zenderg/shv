import { useMemo, useState } from 'react';
import { DialogBackdrop, DialogClose, DialogTitle } from '../../components/DialogBackdrop';
import { CloseIcon } from '../../components/icons';
import type { CategoryLabelSummary } from '../../lib/api';

export function ManageLabelsDialog({
  busy,
  categoryName,
  error,
  onClose,
  onRemove,
  onRename,
  summary
}: {
  busy: boolean;
  categoryName: string;
  error: string | null;
  onClose: () => void;
  onRemove: (label: string) => Promise<boolean>;
  onRename: (from: string, to: string) => Promise<boolean>;
  summary: CategoryLabelSummary;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const mergeTarget = useMemo(() => {
    const key = normalizedKey(draft);
    return key && key !== normalizedKey(editing ?? '')
      ? summary.items.find((item) => normalizedKey(item.name) === key)?.name ?? null
      : null;
  }, [draft, editing, summary.items]);

  return (
    <DialogBackdrop onClose={onClose}>
      <section className="formDialog manageLabelsDialog">
        <header>
          <div>
            <DialogTitle>Manage labels</DialogTitle>
            <p>{categoryName}</p>
          </div>
          <DialogClose asChild>
            <button aria-label="Close Manage labels" disabled={busy} type="button"><CloseIcon /></button>
          </DialogClose>
        </header>
        {summary.items.length ? (
          <div className="manageLabelsList">
            {summary.items.map((label) => (
              <div className="manageLabelRow" key={label.name.toLowerCase()}>
                {editing === label.name ? (
                  <form
                    className="manageLabelEdit"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (draft.trim() && await onRename(label.name, draft)) {
                        setEditing(null);
                        setDraft('');
                      }
                    }}
                  >
                    <label>
                      New name
                      <input
                        autoFocus
                        disabled={busy}
                        maxLength={60}
                        onChange={(event) => setDraft(event.target.value)}
                        value={draft}
                      />
                    </label>
                    {mergeTarget ? <p className="mergeNotice">This will merge with “{mergeTarget}”.</p> : null}
                    <div className="manageLabelActions">
                      <button disabled={busy} onClick={() => setEditing(null)} type="button">Cancel</button>
                      <button disabled={busy || !draft.trim()} type="submit">{busy ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                ) : removing === label.name ? (
                  <div className="manageLabelConfirmation">
                    <strong>Remove “{label.name}” from {videoCount(label.count)}?</strong>
                    <p>Videos won’t be deleted.</p>
                    <div className="manageLabelActions">
                      <button disabled={busy} onClick={() => setRemoving(null)} type="button">Cancel</button>
                      <button
                        className="dangerButton"
                        disabled={busy}
                        onClick={async () => {
                          if (await onRemove(label.name)) {
                            setRemoving(null);
                          }
                        }}
                        type="button"
                      >
                        {busy ? 'Removing…' : 'Remove label'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="manageLabelIdentity">
                      <strong title={label.name}>{label.name}</strong>
                      <span>{videoCount(label.count)}</span>
                    </div>
                    <div className="manageLabelActions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRemoving(null);
                          setEditing(label.name);
                          setDraft(label.name);
                        }}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="dangerTextButton"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                          setRemoving(label.name);
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : <p className="manageLabelsEmpty">This category has no labels.</p>}
        {error ? <p className="inlineDialogError" role="alert">{error}</p> : null}
        <div className="dialogActions">
          <DialogClose asChild>
            <button className="secondaryButton" data-dialog-initial-focus disabled={busy} type="button">Done</button>
          </DialogClose>
        </div>
      </section>
    </DialogBackdrop>
  );
}

function normalizedKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function videoCount(count: number): string {
  return `${count} ${count === 1 ? 'video' : 'videos'}`;
}

import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react';

export interface LabelInputHandle {
  value: () => string[];
}

export const LabelInput = forwardRef<LabelInputHandle, {
  availableLabels: string[];
  disabled?: boolean;
  labels: string[];
  onChange: (labels: string[]) => void;
}>(function LabelInput({ availableLabels, disabled = false, labels, onChange }, ref) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const suggestionsId = useId();

  useImperativeHandle(ref, () => ({
    value: () => normalizeLabelValues([...labels, draft])
  }), [draft, labels]);

  function commitDraft() {
    const next = normalizeLabelValues([...labels, draft]);
    if (next.length !== labels.length || next.some((label, index) => label !== labels[index])) {
      onChange(next);
    }
    setDraft('');
  }

  return (
    <div className="labelField">
      <label htmlFor={inputId}>
        Labels <span>Optional</span>
      </label>
      <div className="labelInputShell" onClick={() => inputRef.current?.focus()}>
        {labels.map((label) => (
          <span className="assignedLabelChip" key={label.toLowerCase()}>
            <span title={label}>{label}</span>
            <button
              aria-label={`Remove label ${label}`}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onChange(labels.filter((item) => item !== label));
              }}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
        <input
          aria-describedby={`${inputId}-hint`}
          disabled={disabled}
          id={inputId}
          list={suggestionsId}
          maxLength={60}
          onBlur={commitDraft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              event.preventDefault();
              commitDraft();
            } else if (event.key === 'Backspace' && !draft && labels.length > 0) {
              onChange(labels.slice(0, -1));
            }
          }}
          placeholder={labels.length ? 'Add another…' : 'Type a label and press Enter'}
          ref={inputRef}
          value={draft}
        />
        <datalist id={suggestionsId}>
          {availableLabels
            .filter((label) => !labels.some((selected) => selected.toLowerCase() === label.toLowerCase()))
            .map((label) => <option key={label.toLowerCase()} value={label} />)}
        </datalist>
      </div>
      <p className="fieldHint" id={`${inputId}-hint`}>Press Enter after each label.</p>
    </div>
  );
});

export function normalizeLabelValues(values: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (name && !byKey.has(name.toLowerCase())) {
      byKey.set(name.toLowerCase(), name);
    }
  }
  return [...byKey.values()];
}

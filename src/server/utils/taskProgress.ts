export type TaskProgressUpdate =
  | {
      kind: 'activity';
      label?: string;
    }
  | {
      kind: 'progress';
      fraction: number;
      label?: string;
    };

export type TaskProgressCallback = (update: TaskProgressUpdate) => void;

export function progressUpdate(fraction: number, label?: string): TaskProgressUpdate {
  return label === undefined ? { kind: 'progress', fraction } : { kind: 'progress', fraction, label };
}

export function activityUpdate(label?: string): TaskProgressUpdate {
  return label === undefined ? { kind: 'activity' } : { kind: 'activity', label };
}

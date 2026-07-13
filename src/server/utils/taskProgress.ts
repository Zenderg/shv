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

export function progressLogMilestone(fraction: number): number {
  const progress = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  if (progress >= 1) return 100;
  if (progress >= 0.99) return 99;
  if (progress >= 0.95) return 95;
  return Math.floor(progress * 10) * 10;
}

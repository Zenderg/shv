export type QueueStatusGroup = 'active' | 'attention' | 'canceled' | 'completed' | 'pending';

const STATUS_GROUPS: Record<string, QueueStatusGroup> = {
  pending: 'pending',
  analyzing: 'active',
  downloading: 'active',
  processing: 'active',
  adding_subtitles: 'active',
  needs_manual_selection: 'attention',
  needs_subtitle_selection: 'attention',
  failed: 'attention',
  canceled: 'canceled',
  completed: 'completed'
};

const GROUP_PRIORITIES: Record<QueueStatusGroup, number> = {
  attention: 0,
  active: 1,
  pending: 2,
  canceled: 3,
  completed: 3
};

export function queueStatusGroup(status: string): QueueStatusGroup {
  return STATUS_GROUPS[status] ?? 'attention';
}

export function queueStatusPriority(status: string): number {
  return GROUP_PRIORITIES[queueStatusGroup(status)];
}

export function sortQueueJobs<T extends { createdAt: string; status: string }>(jobs: T[]): T[] {
  return [...jobs].sort((left, right) =>
    queueStatusPriority(left.status) - queueStatusPriority(right.status) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}

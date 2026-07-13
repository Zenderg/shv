import { JobCanceledError, onAbort } from '../utils/cancellation.js';
import { logJobEvent } from '../utils/jobLogger.js';
import {
  progressLogMilestone,
  type TaskProgressCallback,
  type TaskProgressUpdate
} from '../utils/taskProgress.js';
import type { JobService } from './jobService.js';

const PROGRESS_PERSIST_INTERVAL_MS = 750;
const PROGRESS_PERSIST_DELTA = 0.01;

class DownloadStalledError extends Error {
  constructor(jobId: string, timeoutMs: number, progress: number, taskLabel: string) {
    super(`${taskLabel} stalled for ${Math.round(timeoutMs / 1000)}s without activity (job ${jobId}, last progress ${Math.round(progress * 100)}%).`);
    this.name = 'DownloadStalledError';
  }
}

interface ProgressReporterInput {
  jobId: string;
  jobs: JobService;
  runId: string;
  signal: AbortSignal;
  status: Parameters<JobService['updateProgress']>[1];
}

export function createJobProgressReporter({
  jobId,
  jobs,
  runId,
  signal,
  status
}: ProgressReporterInput): TaskProgressCallback {
  const initial = jobs.get(jobId);
  let currentProgress = initial?.stageProgress ?? null;
  let currentLabel = initial?.progressLabel ?? null;
  let lastPersistedProgress = currentProgress;
  let lastPersistedLabel = currentLabel;
  let lastPersistedAt = Date.now();

  return (update: TaskProgressUpdate) => {
    if (signal.aborted) return;

    if (update.label !== undefined && update.label !== currentLabel) {
      currentLabel = update.label;
      currentProgress = null;
    }
    if (update.kind === 'progress') {
      const next = clamp01(update.fraction);
      currentProgress = currentProgress === null ? next : Math.max(currentProgress, next);
    }

    const now = Date.now();
    const labelChanged = currentLabel !== lastPersistedLabel;
    const determinateChanged = (currentProgress === null) !== (lastPersistedProgress === null);
    const progressChanged = currentProgress !== lastPersistedProgress;
    const progressDelta = currentProgress !== null && lastPersistedProgress !== null
      ? currentProgress - lastPersistedProgress
      : 0;
    const shouldPersist = labelChanged
      || determinateChanged
      || progressDelta >= PROGRESS_PERSIST_DELTA
      || currentProgress === 1
      || (progressChanged && now - lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS);
    if (!shouldPersist) return;

    if (jobs.updateProgress(jobId, status, runId, currentProgress, currentLabel)) {
      lastPersistedAt = now;
      lastPersistedLabel = currentLabel;
      lastPersistedProgress = currentProgress;
    }
  };
}

interface MonitoredJobStageInput<T> extends ProgressReporterInput {
  eventName: string;
  logDeterminateProgress?: boolean;
  run: (onProgress: TaskProgressCallback, signal: AbortSignal) => Promise<T>;
  taskLabel: string;
  timeoutMs: number;
}

export async function runMonitoredJobStage<T>({
  eventName,
  jobId,
  jobs,
  logDeterminateProgress = false,
  run,
  runId,
  signal: parentSignal,
  status,
  taskLabel,
  timeoutMs
}: MonitoredJobStageInput<T>): Promise<T> {
  const stageController = new AbortController();
  let lastProgress = 0;
  let lastLoggedMilestone = -1;
  let lastActivityAt = Date.now();
  let timeout: NodeJS.Timeout | null = null;
  let settled = false;
  const persistProgress = createJobProgressReporter({ jobId, jobs, runId, signal: parentSignal, status });

  const clearTimer = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  let finishReject: (reason?: unknown) => void = () => undefined;
  const scheduleWatchdog = (delayMs = timeoutMs) => {
    clearTimer();
    timeout = setTimeout(() => {
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs < timeoutMs) {
        scheduleWatchdog(timeoutMs - idleMs);
        return;
      }
      const error = new DownloadStalledError(jobId, timeoutMs, lastProgress, taskLabel);
      logJobEvent('warn', `${eventName}-stalled`, {
        jobId,
        lastProgress: progressForLog(lastProgress),
        timeoutSeconds: Math.round(timeoutMs / 1000)
      });
      stageController.abort();
      finishReject(error);
    }, Math.max(1, delayMs));
  };

  return await new Promise<T>((resolve, reject) => {
    let removeParentAbortListener: () => void = () => undefined;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimer();
      removeParentAbortListener();
      callback();
    };
    finishReject = (error) => settle(() => reject(error));
    removeParentAbortListener = onAbort(parentSignal, () => {
      stageController.abort();
      finishReject(new JobCanceledError());
    });
    const onProgress: TaskProgressCallback = (update) => {
      lastActivityAt = Date.now();
      if (update.kind === 'progress') {
        lastProgress = Math.max(lastProgress, clamp01(update.fraction));
        persistProgress({ ...update, fraction: lastProgress });
        const milestone = progressLogMilestone(lastProgress);
        if (logDeterminateProgress && milestone > lastLoggedMilestone) {
          lastLoggedMilestone = milestone;
          logJobEvent('info', 'download-progress', { jobId, progress: progressForLog(lastProgress) });
        }
      } else {
        persistProgress(update);
      }
    };

    scheduleWatchdog();
    run(onProgress, stageController.signal).then(
      (result) => settle(() => resolve(result)),
      (error) => settle(() => reject(error))
    );
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function progressForLog(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

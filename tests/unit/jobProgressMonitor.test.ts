import { afterEach, describe, expect, test, vi } from 'vitest';
import { createJobProgressReporter, runMonitoredJobStage } from '../../src/server/jobs/jobProgressMonitor.js';
import type { JobService } from '../../src/server/jobs/jobService.js';
import { progressUpdate } from '../../src/server/utils/taskProgress.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('job progress reporter', () => {
  test('does not persist the same completed progress more than once', () => {
    const { jobs, updateProgress } = progressJobs();
    const report = createJobProgressReporter({
      jobId: 'job-id',
      jobs,
      runId: 'run-id',
      signal: new AbortController().signal,
      status: 'processing'
    });

    report(progressUpdate(1, 'Finalizing video'));
    report(progressUpdate(1, 'Finalizing video'));

    expect(updateProgress).toHaveBeenCalledTimes(1);
    expect(updateProgress).toHaveBeenCalledWith('job-id', 'processing', 'run-id', 1, 'Finalizing video');
  });
});

describe('monitored job stage', () => {
  test('starts determinate progress over when the task label changes', async () => {
    const { jobs, updateProgress } = progressJobs();

    await runMonitoredJobStage({
      eventName: 'download',
      jobId: 'job-id',
      jobs,
      run: async (onProgress) => {
        onProgress(progressUpdate(0.8, 'Downloading video stream'));
        onProgress(progressUpdate(0.2, 'Downloading audio stream'));
      },
      runId: 'run-id',
      signal: new AbortController().signal,
      stallKind: 'network',
      status: 'downloading',
      taskLabel: 'Download',
      timeoutMs: 10_000
    });

    expect(updateProgress).toHaveBeenNthCalledWith(
      1,
      'job-id',
      'downloading',
      'run-id',
      0.8,
      'Downloading video stream'
    );
    expect(updateProgress).toHaveBeenNthCalledWith(
      2,
      'job-id',
      'downloading',
      'run-id',
      0.2,
      'Downloading audio stream'
    );
  });

  test('waits for timed-out work to settle and preserves the stall error', async () => {
    vi.useFakeTimers();
    const { jobs } = progressJobs();
    const work = deferred<string>();
    let stageSignal: AbortSignal | null = null;
    let outcome = 'pending';

    const monitored = runMonitoredJobStage({
      eventName: 'download',
      jobId: 'job-id',
      jobs,
      run: async (_onProgress, signal) => {
        stageSignal = signal;
        return work.promise;
      },
      runId: 'run-id',
      signal: new AbortController().signal,
      stallKind: 'network',
      status: 'downloading',
      taskLabel: 'Download',
      timeoutMs: 100
    });
    const observed = monitored.then(
      () => {
        outcome = 'resolved';
        return null;
      },
      (error: unknown) => {
        outcome = 'rejected';
        return error;
      }
    );

    await vi.advanceTimersByTimeAsync(100);

    expect((stageSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(outcome).toBe('pending');

    work.resolve('late success');
    const error = await observed;
    expect(outcome).toBe('rejected');
    expect(error).toMatchObject({ name: 'DownloadStalledError' });
  });

  test('waits for canceled work to settle and preserves the cancellation error', async () => {
    const { jobs } = progressJobs();
    const parent = new AbortController();
    const work = deferred<string>();
    let stageSignal: AbortSignal | null = null;
    let outcome = 'pending';

    const monitored = runMonitoredJobStage({
      eventName: 'download',
      jobId: 'job-id',
      jobs,
      run: async (_onProgress, signal) => {
        stageSignal = signal;
        return work.promise;
      },
      runId: 'run-id',
      signal: parent.signal,
      stallKind: 'network',
      status: 'downloading',
      taskLabel: 'Download',
      timeoutMs: 10_000
    });
    const observed = monitored.then(
      () => {
        outcome = 'resolved';
        return null;
      },
      (error: unknown) => {
        outcome = 'rejected';
        return error;
      }
    );

    parent.abort();
    await Promise.resolve();

    expect((stageSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(outcome).toBe('pending');

    work.reject(new Error('cleanup failure after cancellation'));
    const error = await observed;
    expect(outcome).toBe('rejected');
    expect(error).toMatchObject({ name: 'JobCanceledError' });
  });
});

function progressJobs(initial: { progressLabel: string | null; stageProgress: number | null } | null = null) {
  const updateProgress = vi.fn(() => true);
  const jobs = {
    get: vi.fn(() => initial),
    updateProgress
  } as unknown as JobService;
  return { jobs, updateProgress };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

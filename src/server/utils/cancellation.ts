export class JobCanceledError extends Error {
  constructor(message = 'Job canceled') {
    super(message);
    this.name = 'JobCanceledError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new JobCanceledError();
  }
}

export function isCancellationError(error: unknown): boolean {
  return (
    error instanceof JobCanceledError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'JobCanceledError'))
  );
}

export function onAbort(signal: AbortSignal | undefined, callback: () => void): () => void {
  if (!signal) {
    return () => undefined;
  }
  if (signal.aborted) {
    callback();
    return () => undefined;
  }
  signal.addEventListener('abort', callback, { once: true });
  return () => signal.removeEventListener('abort', callback);
}

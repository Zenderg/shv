import type { ReactNode } from 'react';

export function InlineNotice({
  action,
  children,
  tone = 'warning'
}: {
  action?: ReactNode;
  children: ReactNode;
  tone?: 'danger' | 'warning';
}) {
  return (
    <div className="inlineNotice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function PageLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="loadErrorState" role="alert">
      <h2>Couldn’t load this view</h2>
      <p>{message}</p>
      <button className="primaryButton" onClick={onRetry} type="button">
        Try again
      </button>
    </section>
  );
}

export function LibrarySkeleton() {
  return (
    <section aria-label="Loading videos" aria-live="polite" className="libraryGrid skeletonGrid">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div aria-hidden="true" className="skeletonCard" key={item}>
          <span className="skeletonPoster" />
          <span className="skeletonLine wide" />
          <span className="skeletonLine" />
        </div>
      ))}
      <span className="srOnly">Loading videos…</span>
    </section>
  );
}

export function QueueSkeleton() {
  return (
    <section aria-label="Loading queue" aria-live="polite" className="queueList skeletonQueue">
      {[0, 1, 2].map((item) => (
        <div aria-hidden="true" className="skeletonQueueCard" key={item}>
          <span className="skeletonLine wide" />
          <span className="skeletonLine" />
          <span className="skeletonBar" />
        </div>
      ))}
      <span className="srOnly">Loading queue…</span>
    </section>
  );
}

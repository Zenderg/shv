import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SourceExtensionKind } from '../../shared/sourceExtension';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { InlineNotice, LibrarySkeleton, PageLoadError, QueueSkeleton } from './components/AsyncStates';
import { MobileNavigation } from './components/MobileNavigation';
import { appQueryKeys, useCategoriesQuery, useMediaQuery, useQueueQuery, useRuntimeConfigQuery } from './features/app/queries';
import { disappearedQueueJobs, removedJobCategoryIds, resolveCompletedJobs } from './features/app/queueTransitions';
import { AddVideoDialog } from './features/dialogs/AddVideoDialog';
import { CategoryNameDialog } from './features/dialogs/CategoryNameDialog';
import { ConfirmDialog } from './features/dialogs/ConfirmDialog';
import { EditDialog } from './features/dialogs/EditDialog';
import { ExtensionInstallDialog } from './features/dialogs/ExtensionInstallDialog';
import { PlayerDialog } from './features/dialogs/PlayerDialog';
import { LibraryGrid } from './features/library/LibraryGrid';
import { CompletionToasts, type CompletionNotice } from './features/queue/CompletionToasts';
import { QueuePanel } from './features/queue/QueuePanel';
import { countQueueJobs, queueCountsLabel } from './features/queue/queueSummary';
import { sortQueueJobs } from './features/queue/queueStatus';
import { api, type Category, type DownloadJob, type MediaItem, type QueueSnapshot } from './lib/api';
import { checkSourceExtension, openSourceWithExtension, type ExtensionStatus } from './lib/extensionBridge';
import { message } from './utils/format';

type DialogState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'createCategory' }
  | { kind: 'play'; item: MediaItem }
  | { kind: 'edit'; item: MediaItem }
  | { category: Category; kind: 'deleteCategory' }
  | { category: Category; kind: 'renameCategory' }
  | { item: MediaItem; kind: 'deleteMedia' };

type AppPage = 'library' | 'queue';

type ExtensionDialogState =
  | { kind: 'none' }
  | { job: DownloadJob | null; kind: 'issue'; status: Exclude<ExtensionStatus, { kind: 'ready' }> };

const EMPTY_QUEUE: QueueSnapshot = { jobs: [], candidatesByJobId: {} };

export function App() {
  const queryClient = useQueryClient();
  const categoriesQuery = useCategoriesQuery();
  const queueQuery = useQueueQuery();
  const runtimeConfigQuery = useRuntimeConfigQuery();
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionDialogState>({ kind: 'none' });
  const [extensionDialogError, setExtensionDialogError] = useState<string | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus | null>(null);
  const [openCategoryMenuId, setOpenCategoryMenuId] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>('library');
  const [queueActionJobIds, setQueueActionJobIds] = useState<Record<string, string>>({});
  const [queueActionErrors, setQueueActionErrors] = useState<Record<string, string>>({});
  const [completionAnnouncement, setCompletionAnnouncement] = useState('');
  const [completionNotices, setCompletionNotices] = useState<CompletionNotice[]>([]);
  const [sourceTabOpenedJobIds, setSourceTabOpenedJobIds] = useState<Record<string, boolean>>({});
  const completionCheckGenerationRef = useRef(0);
  const completionChecksRef = useRef(new Set<string>());
  const completionNotifiedJobIdsRef = useRef(new Set<string>());
  const pendingCompletionJobsRef = useRef(new Map<string, DownloadJob>());
  const previousVisibleJobsRef = useRef<DownloadJob[] | null>(null);

  const categories = categoriesQuery.data ?? [];
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;
  const currentCategoryId = selectedCategory?.id ?? '';
  const mediaQuery = useMediaQuery(currentCategoryId);
  const media = mediaQuery.data ?? [];
  const queue = queueQuery.data ?? EMPTY_QUEUE;
  const sortedJobs = useMemo(() => sortQueueJobs(queue.jobs), [queue.jobs]);
  const queueCounts = useMemo(() => countQueueJobs(queue.jobs), [queue.jobs]);
  const queueSummary = useMemo(() => queueCountsLabel(queueCounts), [queueCounts]);
  const activeProblems = queueCounts.attention;

  useEffect(() => () => {
    completionCheckGenerationRef.current += 1;
    completionChecksRef.current.clear();
    pendingCompletionJobsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!queueQuery.data) {
      return;
    }
    const previousJobs = previousVisibleJobsRef.current;
    previousVisibleJobsRef.current = queueQuery.data.jobs;
    if (!previousJobs) {
      return;
    }

    // Completed jobs disappear from the queue snapshot, so their media queries
    // must be refreshed explicitly after the polling response observes removal.
    for (const categoryId of removedJobCategoryIds(previousJobs, queueQuery.data.jobs)) {
      void queryClient.invalidateQueries({ exact: true, queryKey: appQueryKeys.media(categoryId) });
    }

    const currentJobIds = new Set(queueQuery.data.jobs.map((job) => job.id));
    for (const jobId of pendingCompletionJobsRef.current.keys()) {
      if (currentJobIds.has(jobId)) {
        pendingCompletionJobsRef.current.delete(jobId);
      }
    }
    for (const job of disappearedQueueJobs(previousJobs, queueQuery.data.jobs)) {
      if (!completionNotifiedJobIdsRef.current.has(job.id)) {
        pendingCompletionJobsRef.current.set(job.id, job);
      }
    }

    const jobsToConfirm = [...pendingCompletionJobsRef.current.values()].filter(
      (job) => !completionChecksRef.current.has(job.id)
    );
    if (jobsToConfirm.length === 0) {
      return;
    }

    for (const job of jobsToConfirm) {
      completionChecksRef.current.add(job.id);
    }
    const generation = completionCheckGenerationRef.current;
    void resolveCompletedJobs(jobsToConfirm, api.job).then(({ completed, discarded }) => {
      if (generation !== completionCheckGenerationRef.current) {
        return;
      }
      const stillPendingCompletedJobs = completed.filter((job) => pendingCompletionJobsRef.current.has(job.id));
      for (const job of [...completed, ...discarded]) {
        pendingCompletionJobsRef.current.delete(job.id);
      }
      const newlyCompletedJobs = stillPendingCompletedJobs.filter(
        (job) => !completionNotifiedJobIdsRef.current.has(job.id)
      );
      if (newlyCompletedJobs.length === 0) {
        return;
      }
      for (const job of newlyCompletedJobs) {
        completionNotifiedJobIdsRef.current.add(job.id);
      }
      const notices = newlyCompletedJobs.map((job) => {
        const categoryName = categories.find((category) => category.id === job.categoryId)?.name ?? 'your library';
        return {
          categoryId: job.categoryId,
          categoryName,
          jobId: job.id,
          title: job.titleHint || safeHostname(job.sourceUrl)
        };
      });
      setCompletionNotices((current) => [...notices, ...current.filter((notice) => !notices.some((next) => next.jobId === notice.jobId))].slice(0, 4));
      setCompletionAnnouncement(
        notices.length === 1
          ? `${notices[0].title} finished downloading and was saved to ${notices[0].categoryName}.`
          : `${notices.length} downloads finished and were saved to the library.`
      );
    }).finally(() => {
      for (const job of jobsToConfirm) {
        completionChecksRef.current.delete(job.id);
      }
    });
  }, [categories, queryClient, queueQuery.data, queueQuery.dataUpdatedAt]);

  useEffect(() => {
    function handleSourceHelperEvent(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.channel !== 'SHV_SOURCE_HELPER_EVENT' ||
        event.data?.event?.type !== 'source-selected'
      ) {
        return;
      }
      const selectedJobId = typeof event.data.event.jobId === 'string' ? event.data.event.jobId : null;
      if (selectedJobId) {
        setSourceTabOpenedJobIds((current) => omitKey(current, selectedJobId));
      }
      void queryClient.invalidateQueries({ queryKey: appQueryKeys.queue });
    }

    window.addEventListener('message', handleSourceHelperEvent);
    return () => window.removeEventListener('message', handleSourceHelperEvent);
  }, [queryClient]);

  useEffect(() => {
    const profile = runtimeConfigQuery.data?.sourceExtensionProfile;
    if (!profile) {
      return;
    }
    let active = true;
    setExtensionStatus(null);
    void checkSourceExtension(profile).then((status) => {
      if (active) {
        setExtensionStatus(status);
      }
    });
    return () => {
      active = false;
    };
  }, [runtimeConfigQuery.data?.sourceExtensionProfile]);

  function showDialog(nextDialog: DialogState) {
    setDialogError(null);
    setDialog(nextDialog);
  }

  function closeDialog() {
    if (!dialogBusy) {
      setDialog({ kind: 'none' });
      setDialogError(null);
    }
  }

  async function runDialogAction<T>(operation: () => Promise<T>, onSuccess: (result: T) => Promise<void> | void) {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result = await operation();
      await onSuccess(result);
    } catch (caught) {
      setDialogError(message(caught));
    } finally {
      setDialogBusy(false);
    }
  }

  async function submitJob(input: { sourceUrl: string; categoryId: string; newCategoryName: string }) {
    await runDialogAction(
      async () => {
        let categoryId = input.categoryId;
        if (input.newCategoryName.trim()) {
          const category = await api.createCategory(input.newCategoryName.trim());
          categoryId = category.id;
        }
        await api.createJob(input.sourceUrl.trim(), categoryId);
        return categoryId;
      },
      async (categoryId) => {
        setSelectedCategoryId(categoryId);
        setDialog({ kind: 'none' });
        setPage('queue');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: appQueryKeys.categories }),
          queryClient.invalidateQueries({ queryKey: appQueryKeys.mediaRoot }),
          queryClient.invalidateQueries({ queryKey: appQueryKeys.queue })
        ]);
      }
    );
  }

  async function createCategory(name: string) {
    await runDialogAction(
      () => api.createCategory(name),
      async (category) => {
        setSelectedCategoryId(category.id);
        setDialog({ kind: 'none' });
        setPage('library');
        await queryClient.invalidateQueries({ queryKey: appQueryKeys.categories });
      }
    );
  }

  async function currentSourceExtensionProfile(): Promise<SourceExtensionKind> {
    if (runtimeConfigQuery.data) {
      return runtimeConfigQuery.data.sourceExtensionProfile;
    }
    const config = await queryClient.fetchQuery({
      queryFn: api.runtimeConfig,
      queryKey: appQueryKeys.runtimeConfig,
      staleTime: Number.POSITIVE_INFINITY
    });
    return config.sourceExtensionProfile;
  }

  async function chooseSource(job: DownloadJob) {
    const profile = await currentSourceExtensionProfile();
    const status = await checkSourceExtension(profile);
    setExtensionStatus(status);
    if (status.kind !== 'ready') {
      setExtensionDialogError(null);
      setExtensionDialog({ job, kind: 'issue', status });
      return;
    }
    await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, profile);
    setSourceTabOpenedJobIds((current) => ({ ...current, [job.id]: true }));
  }

  async function recheckExtension(job: DownloadJob | null) {
    setExtensionDialogError(null);
    try {
      const profile = await currentSourceExtensionProfile();
      const status = await checkSourceExtension(profile);
      setExtensionStatus(status);
      if (status.kind !== 'ready') {
        setExtensionDialog({ job, kind: 'issue', status });
        return;
      }
      if (job) {
        await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, profile);
      }
      setExtensionDialog({ kind: 'none' });
    } catch (caught) {
      setExtensionDialogError(message(caught));
    }
  }

  async function runQueueAction(job: DownloadJob, action: string, operation: () => Promise<void>) {
    setQueueActionErrors((current) => omitKey(current, job.id));
    setQueueActionJobIds((current) => ({ ...current, [job.id]: action }));
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: appQueryKeys.queue });
    } catch (caught) {
      setQueueActionErrors((current) => ({ ...current, [job.id]: message(caught) }));
    } finally {
      setQueueActionJobIds((current) => omitKey(current, job.id));
    }
  }

  const libraryLoading = categoriesQuery.isPending || (Boolean(currentCategoryId) && mediaQuery.isPending);
  const queueLoading = queueQuery.isPending;
  const currentRefetchError = page === 'queue'
    ? queueQuery.isRefetchError
    : categoriesQuery.isRefetchError || mediaQuery.isRefetchError;

  return (
    <main className="shell">
      <MobileNavigation
        activeProblems={activeProblems}
        addDisabled={dialogBusy || categoriesQuery.isPending}
        categories={categories}
        extensionUpdateAvailable={extensionStatus?.kind === 'outdated'}
        onAdd={() => showDialog({ kind: 'add' })}
        onChooseCategory={(categoryId) => {
          setSelectedCategoryId(categoryId);
          setPage('library');
        }}
        onCreateCategory={() => showDialog({ kind: 'createCategory' })}
        onDeleteCategory={(category) => showDialog({ category, kind: 'deleteCategory' })}
        onRenameCategory={(category) => showDialog({ category, kind: 'renameCategory' })}
        onShowQueue={() => setPage('queue')}
        onUpdateExtension={() => {
          if (extensionStatus?.kind === 'outdated') {
            setExtensionDialogError(null);
            setExtensionDialog({ job: null, kind: 'issue', status: extensionStatus });
          }
        }}
        page={page}
        queueItemCount={queueCounts.total}
        queueSummary={queueSummary}
        selectedCategoryId={currentCategoryId}
      />

      <AppSidebar
        categories={categories}
        onChooseCategory={(categoryId) => {
          setSelectedCategoryId(categoryId);
          setPage('library');
        }}
        onCreateCategory={() => showDialog({ kind: 'createCategory' })}
        onDeleteCategory={(category) => showDialog({ category, kind: 'deleteCategory' })}
        onOpenCategoryMenuChange={setOpenCategoryMenuId}
        onRenameCategory={(category) => showDialog({ category, kind: 'renameCategory' })}
        onShowQueue={() => setPage('queue')}
        openCategoryMenuId={openCategoryMenuId}
        page={page}
        queueItemCount={queueCounts.total}
        queueSummary={queueSummary}
        selectedCategoryId={currentCategoryId}
      />

      <section className="workspace">
        <AppHeader
          activeProblems={activeProblems}
          busy={dialogBusy || categoriesQuery.isPending}
          categoryName={selectedCategory?.name ?? null}
          extensionUpdateAvailable={extensionStatus?.kind === 'outdated'}
          loading={page === 'queue' ? queueLoading : libraryLoading}
          mediaCount={media.length}
          onAdd={() => showDialog({ kind: 'add' })}
          onUpdateExtension={() => {
            if (extensionStatus?.kind === 'outdated') {
              setExtensionDialogError(null);
              setExtensionDialog({ job: null, kind: 'issue', status: extensionStatus });
            }
          }}
          page={page}
          queueCounts={queueCounts}
        />

        {currentRefetchError ? (
          <InlineNotice
            action={
              <button
                onClick={() => void (page === 'queue' ? queueQuery.refetch() : Promise.all([categoriesQuery.refetch(), mediaQuery.refetch()]))}
                type="button"
              >
                Retry
              </button>
            }
          >
            Couldn’t refresh. Showing the last loaded data.
          </InlineNotice>
        ) : null}

        {page === 'library' ? (
          renderLibrary()
        ) : (
          renderQueue()
        )}
      </section>

      {dialog.kind === 'add' ? (
        <AddVideoDialog
          busy={dialogBusy}
          categories={categories}
          error={dialogError}
          initialCategoryId={currentCategoryId}
          onClose={closeDialog}
          onSubmit={(input) => void submitJob(input)}
        />
      ) : null}
      {dialog.kind === 'createCategory' ? (
        <CategoryNameDialog
          actionLabel="Create category"
          busy={dialogBusy}
          error={dialogError}
          initialName=""
          onClose={closeDialog}
          onSave={(name) => void createCategory(name)}
          title="New category"
        />
      ) : null}
      {dialog.kind === 'play' ? <PlayerDialog item={dialog.item} onClose={closeDialog} /> : null}
      {dialog.kind === 'edit' ? (
        <EditDialog
          busy={dialogBusy}
          categories={categories}
          error={dialogError}
          item={dialog.item}
          onClose={closeDialog}
          onSave={(body) =>
            runDialogAction(
              () => api.updateMedia(dialog.item.id, body),
              async () => {
                setDialog({ kind: 'none' });
                await queryClient.invalidateQueries({ queryKey: appQueryKeys.mediaRoot });
              }
            )
          }
        />
      ) : null}
      {dialog.kind === 'renameCategory' ? (
        <CategoryNameDialog
          actionLabel="Save"
          busy={dialogBusy}
          error={dialogError}
          initialName={dialog.category.name}
          onClose={closeDialog}
          onSave={(name) =>
            void runDialogAction(
              () => api.renameCategory(dialog.category.id, name),
              async () => {
                setSelectedCategoryId(dialog.category.id);
                setDialog({ kind: 'none' });
                await queryClient.invalidateQueries({ queryKey: appQueryKeys.categories });
              }
            )
          }
          title="Rename category"
        />
      ) : null}
      {dialog.kind === 'deleteCategory' ? (
        <ConfirmDialog
          actionLabel="Delete category"
          busy={dialogBusy}
          danger
          error={dialogError}
          message={`Delete "${dialog.category.name}" and all videos in it? This removes the saved video files from disk.`}
          onClose={closeDialog}
          onConfirm={() =>
            runDialogAction(
              () => api.deleteCategory(dialog.category.id),
              async () => {
                setDialog({ kind: 'none' });
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: appQueryKeys.categories }),
                  queryClient.invalidateQueries({ queryKey: appQueryKeys.mediaRoot }),
                  queryClient.invalidateQueries({ queryKey: appQueryKeys.queue })
                ]);
              }
            )
          }
          title="Delete category"
        />
      ) : null}
      {dialog.kind === 'deleteMedia' ? (
        <ConfirmDialog
          actionLabel="Delete video"
          busy={dialogBusy}
          danger
          error={dialogError}
          message={`Delete "${dialog.item.title}" from the library?`}
          onClose={closeDialog}
          onConfirm={() =>
            runDialogAction(
              () => api.deleteMedia(dialog.item.id),
              async () => {
                setDialog({ kind: 'none' });
                await queryClient.invalidateQueries({ queryKey: appQueryKeys.mediaRoot });
              }
            )
          }
          title="Delete video"
        />
      ) : null}
      {extensionDialog.kind !== 'none' ? (
        <ExtensionInstallDialog
          error={extensionDialogError}
          job={extensionDialog.job}
          onCheckAgain={() => void recheckExtension(extensionDialog.job)}
          onClose={() => {
            setExtensionDialog({ kind: 'none' });
            setExtensionDialogError(null);
          }}
          sourceExtensionProfile={runtimeConfigQuery.data?.sourceExtensionProfile ?? 'prod'}
          status={extensionDialog.status}
        />
      ) : null}
      <CompletionToasts
        announcement={completionAnnouncement}
        notices={completionNotices}
        onDismiss={(jobId) => setCompletionNotices((current) => current.filter((notice) => notice.jobId !== jobId))}
        onOpenCategory={(notice) => {
          setSelectedCategoryId(notice.categoryId);
          setPage('library');
          setCompletionNotices((current) => current.filter((item) => item.jobId !== notice.jobId));
        }}
      />
    </main>
  );

  function renderLibrary() {
    if (categoriesQuery.isPending || (currentCategoryId && mediaQuery.isPending)) {
      return <LibrarySkeleton />;
    }
    if (categoriesQuery.isError && !categoriesQuery.data) {
      return <PageLoadError message={message(categoriesQuery.error)} onRetry={() => void categoriesQuery.refetch()} />;
    }
    if (mediaQuery.isError && !mediaQuery.data && currentCategoryId) {
      return <PageLoadError message={message(mediaQuery.error)} onRetry={() => void mediaQuery.refetch()} />;
    }
    return (
      <LibraryGrid
        categories={categories}
        categoryName={selectedCategory?.name ?? null}
        items={media}
        onAdd={() => showDialog({ kind: 'add' })}
        onCreateCategory={() => showDialog({ kind: 'createCategory' })}
        onDelete={(item) => showDialog({ item, kind: 'deleteMedia' })}
        onEdit={(item) => showDialog({ kind: 'edit', item })}
        onPlay={(item) => showDialog({ kind: 'play', item })}
      />
    );
  }

  function renderQueue() {
    if (queueQuery.isPending) {
      return <QueueSkeleton />;
    }
    if (queueQuery.isError && !queueQuery.data) {
      return <PageLoadError message={message(queueQuery.error)} onRetry={() => void queueQuery.refetch()} />;
    }
    if (sortedJobs.length === 0) {
      return (
        <section className="emptyState compactEmptyState">
          <h2>Nothing in the queue</h2>
          <p>New downloads and jobs that need attention will appear here.</p>
          <button className="primaryButton" onClick={() => showDialog({ kind: 'add' })} type="button">
            Add video
          </button>
        </section>
      );
    }
    return (
      <QueuePanel
        actionErrors={queueActionErrors}
        busyJobIds={queueActionJobIds}
        candidatesByJobId={queue.candidatesByJobId}
        categories={categories}
        jobs={sortedJobs}
        onCancel={(job) => void runQueueAction(job, 'Canceling', () => api.cancelJob(job.id).then(() => undefined))}
        onDelete={(job) => void runQueueAction(job, 'Deleting', () => api.deleteJob(job.id))}
        onManual={(job) => void runQueueAction(job, 'Opening source', () => chooseSource(job))}
        onRetry={(job) => void runQueueAction(job, 'Retrying', () => api.retryJob(job.id).then(() => undefined))}
        onSubtitleNext={(job, subtitleTrackUrl) =>
          void runQueueAction(job, 'Continuing', () => api.selectSubtitleTrack(job.id, subtitleTrackUrl).then(() => undefined))
        }
        sourceTabOpenedJobIds={sourceTabOpenedJobIds}
      />
    );
  }
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname || 'Completed download';
  } catch {
    return 'Completed download';
  }
}

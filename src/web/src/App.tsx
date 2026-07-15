import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SourceExtensionKind } from '../../shared/sourceExtension';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { InlineNotice, LibrarySkeleton, PageLoadError, QueueSkeleton } from './components/AsyncStates';
import { MobileNavigation } from './components/MobileNavigation';
import { AppDialogs, type DialogState, type ExtensionDialogState } from './features/app/AppDialogs';
import { appQueryKeys, useCategoriesQuery, useMediaQuery, useQueueQuery, useRuntimeConfigQuery } from './features/app/queries';
import { useQueueCompletionNotifications } from './features/app/useQueueCompletionNotifications';
import { LibraryGrid } from './features/library/LibraryGrid';
import { CompletionToasts } from './features/queue/CompletionToasts';
import { QueuePanel } from './features/queue/QueuePanel';
import { countQueueJobs, queueCountsLabel } from './features/queue/queueSummary';
import { sortQueueJobs } from './features/queue/queueStatus';
import { api, type Category, type DownloadJob, type MediaItem, type QueueSnapshot } from './lib/api';
import { checkSourceExtension, openSourceWithExtension, type ExtensionStatus } from './lib/extensionBridge';
import { message } from './utils/format';

type AppPage = 'library' | 'queue';

const EMPTY_QUEUE: QueueSnapshot = { jobs: [], candidatesByJobId: {} };

export function App() {
  const queryClient = useQueryClient();
  const workspaceRef = useRef<HTMLElement>(null);
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
  const [sourceTabOpenedJobIds, setSourceTabOpenedJobIds] = useState<Record<string, boolean>>({});

  const categories = categoriesQuery.data ?? [];
  const completionNotifications = useQueueCompletionNotifications({
    categories,
    queue: queueQuery.data,
    queueDataUpdatedAt: queueQuery.dataUpdatedAt
  });
  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;
  const currentCategoryId = selectedCategory?.id ?? '';
  const mediaQuery = useMediaQuery(currentCategoryId);
  const media = useMemo(() => mediaQuery.data?.pages.flatMap((mediaPage) => mediaPage.items) ?? [], [mediaQuery.data]);
  const mediaTotal = mediaQuery.data?.pages[0]?.total ?? 0;
  const queue = queueQuery.data ?? EMPTY_QUEUE;
  const sortedJobs = useMemo(() => sortQueueJobs(queue.jobs), [queue.jobs]);
  const queueCounts = useMemo(() => countQueueJobs(queue.jobs), [queue.jobs]);
  const queueSummary = useMemo(() => queueCountsLabel(queueCounts), [queueCounts]);
  const activeProblems = queueCounts.attention;

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

  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [currentCategoryId, page]);

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

  function updateMedia(item: MediaItem, body: { title?: string; categoryId?: string }) {
    return runDialogAction(
      () => api.updateMedia(item.id, body),
      async () => {
        setDialog({ kind: 'none' });
        await queryClient.resetQueries({ queryKey: appQueryKeys.mediaRoot });
      }
    );
  }

  function renameCategory(category: Category, name: string) {
    void runDialogAction(
      () => api.renameCategory(category.id, name),
      async () => {
        setSelectedCategoryId(category.id);
        setDialog({ kind: 'none' });
        await queryClient.invalidateQueries({ queryKey: appQueryKeys.categories });
      }
    );
  }

  function deleteCategory(category: Category) {
    return runDialogAction(
      () => api.deleteCategory(category.id),
      async () => {
        setDialog({ kind: 'none' });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: appQueryKeys.categories }),
          queryClient.resetQueries({ queryKey: appQueryKeys.mediaRoot }),
          queryClient.invalidateQueries({ queryKey: appQueryKeys.queue })
        ]);
      }
    );
  }

  function deleteMedia(item: MediaItem) {
    return runDialogAction(
      () => api.deleteMedia(item.id),
      async () => {
        setDialog({ kind: 'none' });
        await queryClient.resetQueries({ queryKey: appQueryKeys.mediaRoot });
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
  const librarySummary = libraryLoading
    ? 'Loading videos…'
    : `${mediaTotal} saved videos${activeProblems ? `, ${activeProblems} need attention` : ''}`;
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
        librarySummary={librarySummary}
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

      <section className="workspace" ref={workspaceRef}>
        <AppHeader
          activeProblems={activeProblems}
          busy={dialogBusy || categoriesQuery.isPending}
          categoryName={selectedCategory?.name ?? null}
          extensionUpdateAvailable={extensionStatus?.kind === 'outdated'}
          loading={page === 'queue' ? queueLoading : libraryLoading}
          mediaCount={mediaTotal}
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

      <AppDialogs
        busy={dialogBusy}
        categories={categories}
        currentCategoryId={currentCategoryId}
        dialog={dialog}
        error={dialogError}
        extensionDialog={extensionDialog}
        extensionError={extensionDialogError}
        onCheckExtension={(job) => void recheckExtension(job)}
        onClose={closeDialog}
        onCloseExtension={() => {
          setExtensionDialog({ kind: 'none' });
          setExtensionDialogError(null);
        }}
        onCreateCategory={(name) => void createCategory(name)}
        onDeleteCategory={deleteCategory}
        onDeleteMedia={deleteMedia}
        onRenameCategory={renameCategory}
        onSubmitJob={(input) => void submitJob(input)}
        onUpdateMedia={updateMedia}
        sourceExtensionProfile={runtimeConfigQuery.data?.sourceExtensionProfile ?? 'prod'}
      />
      <CompletionToasts
        announcement={completionNotifications.announcement}
        notices={completionNotifications.notices}
        onDismiss={completionNotifications.dismiss}
        onOpenCategory={(notice) => {
          setSelectedCategoryId(notice.categoryId);
          setPage('library');
          completionNotifications.dismiss(notice.jobId);
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
        categoryName={selectedCategory?.name ?? null}
        hasNextPage={Boolean(mediaQuery.hasNextPage)}
        isFetchingNextPage={mediaQuery.isFetchingNextPage}
        items={media}
        nextPageError={mediaQuery.isFetchNextPageError}
        onAdd={() => showDialog({ kind: 'add' })}
        onCreateCategory={() => showDialog({ kind: 'createCategory' })}
        onDelete={(item) => showDialog({ item, kind: 'deleteMedia' })}
        onEdit={(item) => showDialog({ kind: 'edit', item })}
        onLoadMore={() => void mediaQuery.fetchNextPage()}
        onPlay={(item) => showDialog({ kind: 'play', item })}
        scrollElementRef={workspaceRef}
        total={mediaTotal}
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

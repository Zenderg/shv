import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { InlineNotice, LibrarySkeleton, PageLoadError, QueueSkeleton } from './components/AsyncStates';
import { MobileNavigation } from './components/MobileNavigation';
import { AppDialogs, type DialogState } from './features/app/AppDialogs';
import { appQueryKeys, useCategoriesQuery, useMediaQuery, useQueueQuery, useRuntimeConfigQuery } from './features/app/queries';
import { useSourceExtensionWorkflow } from './features/app/useSourceExtensionWorkflow';
import { useQueueCompletionNotifications } from './features/app/useQueueCompletionNotifications';
import { LibraryGrid } from './features/library/LibraryGrid';
import { CompletionToasts } from './features/queue/CompletionToasts';
import { QueuePanel } from './features/queue/QueuePanel';
import { countQueueJobs, queueCountsLabel } from './features/queue/queueSummary';
import { sortQueueJobs } from './features/queue/queueStatus';
import { api, type Category, type DownloadJob, type MediaItem, type QueueSnapshot } from './lib/api';
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
  const [openCategoryMenuId, setOpenCategoryMenuId] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>('library');
  const [queueActionJobIds, setQueueActionJobIds] = useState<Record<string, string>>({});
  const [queueActionErrors, setQueueActionErrors] = useState<Record<string, string>>({});
  const sourceExtension = useSourceExtensionWorkflow({
    profile: runtimeConfigQuery.data?.sourceExtensionProfile,
    queryClient
  });

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
        extensionUpdateAvailable={sourceExtension.status?.kind === 'outdated'}
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
        onUpdateExtension={sourceExtension.showUpdateIssue}
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
          extensionUpdateAvailable={sourceExtension.status?.kind === 'outdated'}
          loading={page === 'queue' ? queueLoading : libraryLoading}
          mediaCount={mediaTotal}
          onAdd={() => showDialog({ kind: 'add' })}
          onUpdateExtension={sourceExtension.showUpdateIssue}
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
        extensionDialog={sourceExtension.dialog}
        extensionError={sourceExtension.error}
        onCheckExtension={(job) => void sourceExtension.recheck(job)}
        onClose={closeDialog}
        onCloseExtension={sourceExtension.closeDialog}
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
        onManual={(job) => void runQueueAction(job, 'Opening source', () => sourceExtension.chooseSource(job))}
        onRetry={(job) => void runQueueAction(job, 'Retrying', () => api.retryJob(job.id).then(() => undefined))}
        onSubtitleNext={(job, subtitleTrackUrl) =>
          void runQueueAction(job, 'Continuing', () => api.selectSubtitleTrack(job.id, subtitleTrackUrl).then(() => undefined))
        }
        sourceTabOpenedJobIds={sourceExtension.sourceTabOpenedJobIds}
      />
    );
  }
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

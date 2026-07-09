import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SourceExtensionKind } from '../../shared/sourceExtension';
import { AppHeader } from './components/AppHeader';
import { AppSidebar } from './components/AppSidebar';
import { AddVideoDialog } from './features/dialogs/AddVideoDialog';
import { CategoryNameDialog } from './features/dialogs/CategoryNameDialog';
import { ConfirmDialog } from './features/dialogs/ConfirmDialog';
import { EditDialog } from './features/dialogs/EditDialog';
import { ExtensionInstallDialog } from './features/dialogs/ExtensionInstallDialog';
import { PlayerDialog } from './features/dialogs/PlayerDialog';
import { LibraryGrid } from './features/library/LibraryGrid';
import { QueuePanel } from './features/queue/QueuePanel';
import { api, type Category, type DownloadJob, type MediaItem, type QueueSnapshot } from './lib/api';
import {
  checkSourceExtension,
  openSourceWithExtension,
  type ExtensionStatus
} from './lib/extensionBridge';
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
  | { job: DownloadJob; kind: 'issue'; status: Exclude<ExtensionStatus, { kind: 'ready' }> };

export function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot>({ jobs: [], candidatesByJobId: {} });
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [extensionDialog, setExtensionDialog] = useState<ExtensionDialogState>({ kind: 'none' });
  const [openCategoryMenuId, setOpenCategoryMenuId] = useState<string | null>(null);
  const [page, setPage] = useState<AppPage>('library');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [queueActionJobIds, setQueueActionJobIds] = useState<Record<string, string>>({});
  const [sourceExtensionProfile, setSourceExtensionProfile] = useState<SourceExtensionKind | null>(null);

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null;

  const refresh = useCallback(async (preferredCategoryId?: string) => {
    const [categoryResult, queueResult] = await Promise.all([api.categories(), api.queue()]);
    setCategories(categoryResult);
    setQueue(queueResult);
    const availableIds = new Set(categoryResult.map((category) => category.id));
    const nextCategoryId =
      (preferredCategoryId && availableIds.has(preferredCategoryId) ? preferredCategoryId : '') ||
      (selectedCategoryId && availableIds.has(selectedCategoryId) ? selectedCategoryId : '') ||
      categoryResult[0]?.id ||
      '';
    setSelectedCategoryId(nextCategoryId);
    setMedia(await api.media(nextCategoryId || undefined));
  }, [selectedCategoryId]);

  useEffect(() => {
    void refresh().catch((caught) => setError(message(caught)));
  }, [refresh]);

  useEffect(() => {
    void api.runtimeConfig()
      .then((config) => setSourceExtensionProfile(config.sourceExtensionProfile))
      .catch((caught) => setError(message(caught)));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void api.queue().then(setQueue).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!openCategoryMenuId) {
      return;
    }

    function closeCategoryMenuOnOutsideClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) {
        return;
      }
      const menuRoot = event.target.closest('[data-category-menu-root]');
      if (menuRoot instanceof HTMLElement && menuRoot.dataset.categoryMenuRoot === openCategoryMenuId) {
        return;
      }
      setOpenCategoryMenuId(null);
    }

    document.addEventListener('mousedown', closeCategoryMenuOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeCategoryMenuOnOutsideClick);
  }, [openCategoryMenuId]);

  async function chooseCategory(categoryId: string) {
    setPage('library');
    setSelectedCategoryId(categoryId);
    setMedia(await api.media(categoryId));
  }

  async function submitJob(input: { sourceUrl: string; categoryId: string; newCategoryName: string }) {
    setBusy(true);
    setError(null);
    try {
      let categoryId = input.categoryId;
      if (input.newCategoryName.trim()) {
        const category = await api.createCategory(input.newCategoryName.trim());
        categoryId = category.id;
      }
      await api.createJob(input.sourceUrl.trim(), categoryId);
      setDialog({ kind: 'none' });
      setPage('queue');
      await refresh(categoryId);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createCategory(name: string) {
    setBusy(true);
    setError(null);
    try {
      const category = await api.createCategory(name);
      setDialog({ kind: 'none' });
      setPage('library');
      await refresh(category.id);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function afterMediaChange() {
    setDialog({ kind: 'none' });
    if (selectedCategoryId) {
      setMedia(await api.media(selectedCategoryId));
    }
    setQueue(await api.queue());
  }

  const refreshQueue = useCallback(async () => {
    setQueue(await api.queue());
  }, []);

  async function currentSourceExtensionProfile(): Promise<SourceExtensionKind> {
    if (sourceExtensionProfile) {
      return sourceExtensionProfile;
    }
    const config = await api.runtimeConfig();
    setSourceExtensionProfile(config.sourceExtensionProfile);
    return config.sourceExtensionProfile;
  }

  useEffect(() => {
    function handleSourceHelperEvent(event: MessageEvent) {
      if (
        event.source !== window ||
        event.data?.channel !== 'SHV_SOURCE_HELPER_EVENT' ||
        event.data?.event?.type !== 'source-selected'
      ) {
        return;
      }
      void refreshQueue().catch((caught) => setError(message(caught)));
    }

    window.addEventListener('message', handleSourceHelperEvent);
    return () => window.removeEventListener('message', handleSourceHelperEvent);
  }, [refreshQueue]);

  async function chooseSource(job: DownloadJob) {
    setError(null);
    const profile = await currentSourceExtensionProfile();
    const status = await checkSourceExtension(profile);
    if (status.kind !== 'ready') {
      setExtensionDialog({ job, kind: 'issue', status });
      return;
    }
    await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, profile);
  }

  async function recheckExtension(job: DownloadJob) {
    const profile = await currentSourceExtensionProfile();
    const status = await checkSourceExtension(profile);
    if (status.kind !== 'ready') {
      setExtensionDialog({ job, kind: 'issue', status });
      return;
    }
    setExtensionDialog({ kind: 'none' });
    await openSourceWithExtension({ jobId: job.id, sourceUrl: job.sourceUrl, titleHint: job.titleHint }, profile);
  }

  async function runQueueAction(job: DownloadJob, action: string, operation: () => Promise<void>) {
    setError(null);
    setQueueActionJobIds((current) => ({ ...current, [job.id]: action }));
    try {
      await operation();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setQueueActionJobIds((current) => {
        const next = { ...current };
        delete next[job.id];
        return next;
      });
    }
  }

  const activeProblems = useMemo(
    () => queue.jobs.filter((job) => ['failed', 'needs_manual_selection', 'needs_subtitle_selection'].includes(job.status)).length,
    [queue.jobs]
  );
  const queueBadgeCount = queue.jobs.length;

  return (
    <main className="shell">
      <AppSidebar
        categories={categories}
        onChooseCategory={(categoryId) => void chooseCategory(categoryId)}
        onCreateCategory={() => setDialog({ kind: 'createCategory' })}
        onDeleteCategory={(category) => setDialog({ category, kind: 'deleteCategory' })}
        onOpenCategoryMenuChange={setOpenCategoryMenuId}
        onRenameCategory={(category) => setDialog({ category, kind: 'renameCategory' })}
        onShowQueue={() => setPage('queue')}
        openCategoryMenuId={openCategoryMenuId}
        page={page}
        queueBadgeCount={queueBadgeCount}
        selectedCategoryId={selectedCategoryId}
      />

      <section className="workspace">
        <AppHeader
          activeProblems={activeProblems}
          busy={busy || categories.length === 0}
          categoryCount={queueBadgeCount}
          categoryName={selectedCategory?.name ?? null}
          mediaCount={media.length}
          onAdd={() => setDialog({ kind: 'add' })}
          page={page}
        />

        {error ? <div className="error">{error}</div> : null}

        {page === 'library' ? (
          <LibraryGrid
            categories={categories}
            items={media}
            onDelete={(item) => setDialog({ item, kind: 'deleteMedia' })}
            onEdit={(item) => setDialog({ kind: 'edit', item })}
            onPlay={(item) => setDialog({ kind: 'play', item })}
          />
        ) : (
          <QueuePanel
            busyJobIds={queueActionJobIds}
            candidatesByJobId={queue.candidatesByJobId}
            jobs={queue.jobs}
            onCancel={(job) =>
              runQueueAction(job, 'Canceling', async () => {
                await api.cancelJob(job.id);
                setQueue(await api.queue());
              })
            }
            onDelete={(job) =>
              runQueueAction(job, 'Deleting', async () => {
                await api.deleteJob(job.id);
                setQueue(await api.queue());
              })
            }
            onManual={(job) => void runQueueAction(job, 'Opening source', () => chooseSource(job))}
            onRetry={(job) =>
              runQueueAction(job, 'Retrying', async () => {
                await api.retryJob(job.id);
                setQueue(await api.queue());
              })
            }
            onSubtitleNext={(job, subtitleTrackUrl) =>
              runQueueAction(job, 'Continuing', async () => {
                await api.selectSubtitleTrack(job.id, subtitleTrackUrl);
                setQueue(await api.queue());
              })
            }
          />
        )}
      </section>

      {dialog.kind === 'add' ? (
        <AddVideoDialog
          busy={busy}
          categories={categories}
          initialCategoryId={selectedCategoryId}
          onClose={() => setDialog({ kind: 'none' })}
          onSubmit={(input) => void submitJob(input)}
        />
      ) : null}
      {dialog.kind === 'createCategory' ? (
        <CategoryNameDialog
          actionLabel="Create category"
          busy={busy}
          initialName=""
          onClose={() => setDialog({ kind: 'none' })}
          onSave={(name) => void createCategory(name)}
          title="New category"
        />
      ) : null}
      {dialog.kind === 'play' ? <PlayerDialog item={dialog.item} onClose={() => setDialog({ kind: 'none' })} /> : null}
      {dialog.kind === 'edit' ? (
        <EditDialog
          categories={categories}
          item={dialog.item}
          onClose={() => setDialog({ kind: 'none' })}
          onSave={async (body) => {
            await api.updateMedia(dialog.item.id, body);
            await afterMediaChange();
          }}
        />
      ) : null}
      {dialog.kind === 'renameCategory' ? (
        <CategoryNameDialog
          actionLabel="Save"
          busy={busy}
          initialName={dialog.category.name}
          onClose={() => setDialog({ kind: 'none' })}
          onSave={async (name) => {
            setBusy(true);
            setError(null);
            try {
              await api.renameCategory(dialog.category.id, name);
              setDialog({ kind: 'none' });
              await refresh(dialog.category.id);
            } catch (caught) {
              setError(message(caught));
            } finally {
              setBusy(false);
            }
          }}
          title="Rename category"
        />
      ) : null}
      {dialog.kind === 'deleteCategory' ? (
        <ConfirmDialog
          actionLabel="Delete category"
          busy={busy}
          danger
          message={`Delete "${dialog.category.name}" and all videos in it? This removes the saved video files from disk.`}
          onClose={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.deleteCategory(dialog.category.id);
              setDialog({ kind: 'none' });
              await refresh();
            } catch (caught) {
              setError(message(caught));
            } finally {
              setBusy(false);
            }
          }}
          title="Delete category"
        />
      ) : null}
      {dialog.kind === 'deleteMedia' ? (
        <ConfirmDialog
          actionLabel="Delete video"
          busy={busy}
          danger
          message={`Delete "${dialog.item.title}" from the library?`}
          onClose={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.deleteMedia(dialog.item.id);
              await afterMediaChange();
            } catch (caught) {
              setError(message(caught));
            } finally {
              setBusy(false);
            }
          }}
          title="Delete video"
        />
      ) : null}
      {extensionDialog.kind !== 'none' ? (
        <ExtensionInstallDialog
          job={extensionDialog.job}
          onCheckAgain={() => void recheckExtension(extensionDialog.job).catch((caught) => setError(message(caught)))}
          onClose={() => setExtensionDialog({ kind: 'none' })}
          sourceExtensionProfile={sourceExtensionProfile ?? 'prod'}
          status={extensionDialog.status}
        />
      ) : null}
    </main>
  );
}

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SourceExtensionKind } from '../../shared/sourceExtension';
import { api, type Category, type DownloadJob, type MediaCandidate, type MediaItem, type QueueSnapshot } from './lib/api';
import {
  SOURCE_EXTENSION_PROTOCOL_VERSION,
  SOURCE_EXTENSION_REQUIRED_VERSION,
  checkSourceExtension,
  openSourceWithExtension,
  sourceExtensionTargetForOrigin,
  type ExtensionStatus
} from './lib/extensionBridge';

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
    () => queue.jobs.filter((job) => job.status === 'failed' || job.status === 'needs_manual_selection').length,
    [queue.jobs]
  );
  const queueBadgeCount = queue.jobs.length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
          <div>
            <strong>shv</strong>
            <span>local library</span>
          </div>
        </div>

        <nav className="queueNav" aria-label="Queue">
          <button className={page === 'queue' ? 'selected' : ''} onClick={() => setPage('queue')} type="button">
            <QueueIcon />
            <span>Queue</span>
            <strong className="navBadge">{queueBadgeCount}</strong>
          </button>
        </nav>

        <div className="categorySection">
          <div className="categoryHeader">
            <span>Categories</span>
            <button aria-label="Create category" onClick={() => setDialog({ kind: 'createCategory' })} type="button">
              <PlusIcon />
            </button>
          </div>
          <nav className="categoryNav" aria-label="Categories">
            {categories.map((category) => (
              <div
                className={page === 'library' && category.id === selectedCategoryId ? 'categoryNavItem selected' : 'categoryNavItem'}
                data-category-menu-root={category.id}
                key={category.id}
              >
                <button
                  className="categoryLink"
                  onClick={() => {
                    setOpenCategoryMenuId(null);
                    void chooseCategory(category.id);
                  }}
                  type="button"
                >
                  <FolderIcon />
                  <span>{category.name}</span>
                </button>
                <button
                  aria-expanded={openCategoryMenuId === category.id}
                  aria-haspopup="menu"
                  aria-label={`Open menu for ${category.name}`}
                  className="categoryMenuButton"
                  onClick={() => setOpenCategoryMenuId((current) => (current === category.id ? null : category.id))}
                  type="button"
                >
                  <EllipsisIcon />
                </button>
                {openCategoryMenuId === category.id ? (
                  <div className="categoryMenu" role="menu">
                    <button
                      onClick={() => {
                        setOpenCategoryMenuId(null);
                        setDialog({ category, kind: 'renameCategory' });
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      className="dangerMenuItem"
                      onClick={() => {
                        setOpenCategoryMenuId(null);
                        setDialog({ category, kind: 'deleteCategory' });
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{page === 'queue' ? 'Queue' : selectedCategory?.name ?? 'Library'}</h1>
            <p>
              {page === 'queue'
                ? `${queueBadgeCount} current ${queueBadgeCount === 1 ? 'job' : 'jobs'}${activeProblems ? `, ${activeProblems} need attention` : ''}`
                : `${media.length} saved videos${activeProblems ? `, ${activeProblems} need attention` : ''}`}
            </p>
          </div>
          <div className="topbarActions">
            <button className="primaryButton" disabled={busy || categories.length === 0} onClick={() => setDialog({ kind: 'add' })} type="button">
              <PlusIcon />
              Add
            </button>
          </div>
        </header>

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

function AddVideoDialog({
  busy,
  categories,
  initialCategoryId,
  onClose,
  onSubmit
}: {
  busy: boolean;
  categories: Category[];
  initialCategoryId: string;
  onClose: () => void;
  onSubmit: (input: { sourceUrl: string; categoryId: string; newCategoryName: string }) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [categoryMode, setCategoryMode] = useState<'existing' | 'new'>('existing');
  const [categoryId, setCategoryId] = useState(initialCategoryId || categories[0]?.id || '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const canSubmit =
    sourceUrl.trim().length > 0 && (categoryMode === 'new' ? newCategoryName.trim().length > 0 : categoryId.length > 0);

  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog addVideoDialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            sourceUrl,
            categoryId: categoryMode === 'existing' ? categoryId : '',
            newCategoryName: categoryMode === 'new' ? newCategoryName : ''
          });
        }}
      >
        <header>
          <div>
            <h2>Add video</h2>
            <p>Choose an existing category or create one.</p>
          </div>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Video URL
          <input
            autoFocus
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://..."
            required
            type="url"
            value={sourceUrl}
          />
        </label>
        <div className="categoryMode" role="group" aria-label="Category mode">
          <button className={categoryMode === 'existing' ? 'selected' : ''} onClick={() => setCategoryMode('existing')} type="button">
            Existing
          </button>
          <button className={categoryMode === 'new' ? 'selected' : ''} onClick={() => setCategoryMode('new')} type="button">
            New
          </button>
        </div>
        {categoryMode === 'existing' ? (
          <label>
            Category
            <select onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            New category
            <input
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="Category name"
              required
              value={newCategoryName}
            />
          </label>
        )}
        <button disabled={busy || !canSubmit} type="submit">
          <PlusIcon />
          Add to queue
        </button>
      </form>
    </DialogBackdrop>
  );
}

function LibraryGrid({
  categories,
  items,
  onDelete,
  onEdit,
  onPlay
}: {
  categories: Category[];
  items: MediaItem[];
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="emptyState">
        <PlayIcon />
        <h2>No videos in this category</h2>
        <p>Add a link above; completed downloads will appear here.</p>
      </section>
    );
  }

  return (
    <section className="libraryGrid" aria-label="Videos">
      {items.map((item) => (
        <article className="videoCard" key={item.id}>
          <button className="poster" onClick={() => onPlay(item)} type="button">
            {item.thumbnailPath ? (
              <img
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
                src={`/thumbnails/${item.id}`}
              />
            ) : (
              <span className="posterPlaceholder" />
            )}
            <span className="playBadge" aria-hidden="true">
              <PlayIcon />
            </span>
            <span className="durationBadge">{formatDuration(item.durationSeconds)}</span>
          </button>
          <div className="videoMeta">
            <h2>{item.title}</h2>
            <p>{formatResolution(item)} · {formatBytes(item.sizeBytes)}</p>
            <span>{categories.find((category) => category.id === item.categoryId)?.name ?? 'Unknown'}</span>
          </div>
          <div className="cardActions">
            <button onClick={() => onEdit(item)} title="Rename or move" type="button">
              <EditIcon />
            </button>
            <button onClick={() => void onDelete(item)} title="Delete" type="button">
              <TrashIcon />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function QueuePanel({
  busyJobIds,
  candidatesByJobId,
  jobs,
  onCancel,
  onDelete,
  onManual,
  onRetry
}: {
  busyJobIds: Record<string, string>;
  candidatesByJobId: Record<string, MediaCandidate[]>;
  jobs: DownloadJob[];
  onCancel: (job: DownloadJob) => void;
  onDelete: (job: DownloadJob) => void;
  onManual: (job: DownloadJob) => void;
  onRetry: (job: DownloadJob) => void;
}) {
  return (
    <section className="queueList" aria-label="Queue jobs">
      {jobs.length === 0 ? <p className="muted">No jobs in queue.</p> : null}
      {jobs.map((job) => {
        const stage = jobStageProgress(job);
        const canCancel = ['pending', 'analyzing', 'downloading', 'processing'].includes(job.status);
        const canRetry = job.status === 'failed' || job.status === 'canceled';
        const actionLabel = busyJobIds[job.id];
        const actionBusy = Boolean(actionLabel);
        return (
          <article className={`queueJob ${job.status}`} key={job.id}>
            <div className="jobHeader">
              <strong>{job.titleHint || new URL(job.sourceUrl).hostname}</strong>
              <span>{job.status.replaceAll('_', ' ')}</span>
            </div>
            <div className="progressStack">
              <ProgressRow label="Overall" value={job.progress} />
              <ProgressRow label={stage.label} value={stage.value} />
            </div>
            {job.errorMessage ? <p>{job.errorMessage}</p> : null}
            <div className="jobActions">
              {job.status === 'needs_manual_selection' || job.status === 'failed' ? (
                <button disabled={actionBusy} onClick={() => onManual(job)} type="button">
                  {actionLabel ?? `Choose source (${candidatesByJobId[job.id]?.length ?? 0})`}
                </button>
              ) : null}
              {canRetry ? (
                <button disabled={actionBusy} onClick={() => onRetry(job)} type="button">
                  {actionLabel ?? 'Retry'}
                </button>
              ) : null}
              {canCancel ? (
                <button disabled={actionBusy} onClick={() => onCancel(job)} type="button">
                  {actionLabel ?? 'Cancel'}
                </button>
              ) : null}
              <button
                className="dangerButton"
                disabled={actionBusy || canCancel}
                onClick={() => onDelete(job)}
                title={canCancel ? 'Cancel the running job before deleting it' : 'Delete from queue'}
                type="button"
              >
                <TrashIcon />
                {actionLabel ?? 'Delete'}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  const normalized = clamp01(value);
  return (
    <div className="progressRow">
      <div>
        <span>{label}</span>
        <strong>{formatProgressPercent(normalized)}</strong>
      </div>
      <progress max={1} value={normalized} />
    </div>
  );
}

function jobStageProgress(job: DownloadJob): { label: string; value: number } {
  switch (job.status) {
    case 'pending':
      return { label: 'Waiting', value: 0 };
    case 'analyzing':
      return { label: 'Analyzing', value: progressWithin(job.progress, 0.05, 0.2) };
    case 'needs_manual_selection':
      return { label: 'Manual selection', value: 1 };
    case 'downloading':
      return { label: 'Downloading', value: progressWithin(job.progress, 0.22, 0.77) };
    case 'processing':
      return { label: 'Processing', value: progressWithin(job.progress, 0.82, 0.98) };
    case 'completed':
      return { label: 'Completed', value: 1 };
    case 'failed':
      return { label: 'Failed', value: 0 };
    case 'canceled':
      return { label: 'Canceled', value: 0 };
  }
}

function PlayerDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="playerDialog">
        <header>
          <h2>{item.title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <video controls src={`/media/${item.id}`} />
      </section>
    </DialogBackdrop>
  );
}

function EditDialog({
  categories,
  item,
  onClose,
  onSave
}: {
  categories: Category[];
  item: MediaItem;
  onClose: () => void;
  onSave: (body: { title?: string; categoryId?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [categoryId, setCategoryId] = useState(item.categoryId);
  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ title, categoryId });
        }}
      >
        <header>
          <h2>Edit video</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Title
          <input onChange={(event) => setTitle(event.target.value)} value={title} />
        </label>
        <label>
          Category
          <select onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Save</button>
      </form>
    </DialogBackdrop>
  );
}

function CategoryNameDialog({
  actionLabel,
  busy,
  initialName,
  onClose,
  onSave,
  title
}: {
  actionLabel: string;
  busy: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
  title: string;
}) {
  const [name, setName] = useState(initialName);
  const canSubmit = name.trim().length > 0;
  return (
    <DialogBackdrop onClose={onClose}>
      <form
        className="formDialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            void onSave(name.trim());
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <label>
          Name
          <input autoFocus onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={busy || !canSubmit} type="submit">
          {actionLabel}
        </button>
      </form>
    </DialogBackdrop>
  );
}

function ConfirmDialog({
  actionLabel,
  busy,
  danger,
  message,
  onClose,
  onConfirm,
  title
}: {
  actionLabel: string;
  busy: boolean;
  danger?: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
}) {
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="formDialog confirmDialog">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <p>{message}</p>
        <div className="dialogActions">
          <button className="secondaryButton" onClick={onClose} type="button">
            Cancel
          </button>
          <button className={danger ? 'dangerButton' : ''} disabled={busy} onClick={() => void onConfirm()} type="button">
            {actionLabel}
          </button>
        </div>
      </section>
    </DialogBackdrop>
  );
}

function ExtensionInstallDialog({
  job,
  onCheckAgain,
  onClose,
  sourceExtensionProfile,
  status
}: {
  job: DownloadJob;
  onCheckAgain: () => void;
  onClose: () => void;
  sourceExtensionProfile: SourceExtensionKind;
  status: Exclude<ExtensionStatus, { kind: 'ready' }>;
}) {
  const isOutdated = status.kind === 'outdated';
  const extensionTarget = sourceExtensionTargetForOrigin(window.location.origin, sourceExtensionProfile);
  return (
    <DialogBackdrop onClose={onClose}>
      <section className="extensionDialog">
        <header>
          <div>
            <h2>{isOutdated ? 'Update browser extension' : 'Install browser extension'}</h2>
            <p>{job.titleHint || safeHostname(job.sourceUrl)}</p>
          </div>
          <button onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </header>
        <div className="extensionDialogBody">
          <p>
            Source selection now uses a browser extension so the source opens in a real browser tab with a live Sources
            sidebar embedded directly into the source page.
            {' '}
            {isOutdated ? 'Your installed extension is too old for this app build.' : 'The extension was not detected.'}
          </p>
          <div className="extensionVersionBox">
            <span>Required extension</span>
            <strong>v{SOURCE_EXTENSION_REQUIRED_VERSION}</strong>
            <span>Protocol</span>
            <strong>{SOURCE_EXTENSION_PROTOCOL_VERSION}</strong>
            {isOutdated ? (
              <>
                <span>Installed extension</span>
                <strong>v{status.currentVersion}</strong>
              </>
            ) : null}
          </div>
          <ol>
            <li>Download the latest {extensionTarget.kind === 'dev' ? 'development' : 'production'} extension package from this app.</li>
            <li>Unzip it somewhere stable on this machine.</li>
            <li>Open your browser extensions page, enable Developer mode, and choose Load unpacked.</li>
            <li>Select the unzipped <code>{extensionTarget.packagePrefix}</code> folder.</li>
            <li>Return here and click Check again.</li>
          </ol>
          <p className="extensionId">
            Expected extension id: <code>{extensionTarget.id}</code>
          </p>
        </div>
        <footer>
          <a className="downloadButton" href={extensionTarget.downloadPath}>
            Download extension
          </a>
          <button onClick={onCheckAgain} type="button">
            Check again
          </button>
        </footer>
      </section>
    </DialogBackdrop>
  );
}

function DialogBackdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="dialogBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(value: number | null): string {
  if (!value) {
    return 'unknown length';
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatResolution(item: Pick<MediaItem, 'height' | 'width'>): string {
  return item.width && item.height ? `${item.width}x${item.height}` : 'unknown resolution';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function progressWithin(value: number, start: number, end: number): number {
  if (end <= start) {
    return 0;
  }
  return clamp01((value - start) / (end - start));
}

function formatProgressPercent(value: number): string {
  const percent = clamp01(value) * 100;
  if (percent > 0 && percent < 0.1) {
    return '<0.1%';
  }
  if (percent > 0 && percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Mark() {
  return <svg viewBox="0 0 32 32"><path d="M4 9a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Zm10 2v10l8-5-8-5Z" /></svg>;
}

function QueueIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 5h14v2H5V5Zm0 6h14v2H5v-2Zm0 6h10v2H5v-2Z" /></svg>;
}

function FolderIcon() {
  return <svg viewBox="0 0 24 24"><path d="M3 6.8A2.8 2.8 0 0 1 5.8 4h4l2 2.2h6.4A2.8 2.8 0 0 1 21 9v8.2a2.8 2.8 0 0 1-2.8 2.8H5.8A2.8 2.8 0 0 1 3 17.2V6.8Z" /></svg>;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.8-6.2c.6-.4.6-1.4 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>;
}

function EditIcon() {
  return <svg viewBox="0 0 24 24"><path d="m5 16.8-.8 3 3-.8L18.7 7.5l-2.2-2.2L5 16.8Zm13.9-13.9 2.2 2.2-1.2 1.2-2.2-2.2 1.2-1.2Z" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24"><path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm1 6h2v8H9v-8Zm4 0h2v8h-2v-8ZM6 10h12l-.8 10H6.8L6 10Z" /></svg>;
}

function EllipsisIcon() {
  return <svg viewBox="0 0 24 24"><path d="M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24"><path d="m6.4 5 12.6 12.6-1.4 1.4L5 6.4 6.4 5Zm12.6 1.4L6.4 19 5 17.6 17.6 5 19 6.4Z" /></svg>;
}

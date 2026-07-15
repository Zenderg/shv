import type { SourceExtensionKind } from '../../../../shared/sourceExtension';
import { AddVideoDialog } from '../dialogs/AddVideoDialog';
import { CategoryNameDialog } from '../dialogs/CategoryNameDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { EditDialog } from '../dialogs/EditDialog';
import { ExtensionInstallDialog } from '../dialogs/ExtensionInstallDialog';
import { ManageLabelsDialog } from '../dialogs/ManageLabelsDialog';
import { PlayerDialog } from '../dialogs/PlayerDialog';
import type { Category, CategoryLabelSummary, DownloadJob, MediaItem } from '../../lib/api';
import type { ExtensionStatus } from '../../lib/extensionBridge';

export type DialogState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'createCategory' }
  | { kind: 'play'; item: MediaItem }
  | { kind: 'edit'; item: MediaItem }
  | { category: Category; kind: 'manageLabels' }
  | { category: Category; kind: 'deleteCategory' }
  | { category: Category; kind: 'renameCategory' }
  | { item: MediaItem; kind: 'deleteMedia' };

export type ExtensionDialogState =
  | { kind: 'none' }
  | { job: DownloadJob | null; kind: 'issue'; status: Exclude<ExtensionStatus, { kind: 'ready' }> };

export function AppDialogs({
  busy,
  categories,
  categoryLabelSummary,
  currentCategoryId,
  dialog,
  error,
  extensionDialog,
  extensionError,
  onCheckExtension,
  onClose,
  onCloseExtension,
  onCreateCategory,
  onDeleteCategory,
  onDeleteMedia,
  onRemoveCategoryLabel,
  onRenameCategory,
  onSubmitJob,
  onUpdateMedia,
  onRenameCategoryLabel,
  sourceExtensionProfile
}: {
  busy: boolean;
  categories: Category[];
  categoryLabelSummary: CategoryLabelSummary;
  currentCategoryId: string;
  dialog: DialogState;
  error: string | null;
  extensionDialog: ExtensionDialogState;
  extensionError: string | null;
  onCheckExtension: (job: DownloadJob | null) => void;
  onClose: () => void;
  onCloseExtension: () => void;
  onCreateCategory: (name: string) => void;
  onDeleteCategory: (category: Category) => Promise<void>;
  onDeleteMedia: (item: MediaItem) => Promise<void>;
  onRemoveCategoryLabel: (label: string) => Promise<boolean>;
  onRenameCategory: (category: Category, name: string) => void;
  onSubmitJob: (input: { sourceUrl: string; categoryId: string; labels: string[]; newCategoryName: string }) => void;
  onUpdateMedia: (item: MediaItem, body: { title?: string; categoryId?: string; labels?: string[] }) => Promise<void>;
  onRenameCategoryLabel: (from: string, to: string) => Promise<boolean>;
  sourceExtensionProfile: SourceExtensionKind;
}) {
  return (
    <>
      {dialog.kind === 'add' ? (
        <AddVideoDialog
          busy={busy}
          categories={categories}
          error={error}
          initialCategoryId={currentCategoryId}
          onClose={onClose}
          onSubmit={onSubmitJob}
        />
      ) : null}
      {dialog.kind === 'createCategory' ? (
        <CategoryNameDialog
          actionLabel="Create category"
          busy={busy}
          error={error}
          initialName=""
          onClose={onClose}
          onSave={onCreateCategory}
          title="New category"
        />
      ) : null}
      {dialog.kind === 'play' ? <PlayerDialog item={dialog.item} onClose={onClose} /> : null}
      {dialog.kind === 'edit' ? (
        <EditDialog
          busy={busy}
          categories={categories}
          error={error}
          item={dialog.item}
          onClose={onClose}
          onSave={(body) => onUpdateMedia(dialog.item, body)}
        />
      ) : null}
      {dialog.kind === 'manageLabels' ? (
        <ManageLabelsDialog
          busy={busy}
          categoryName={dialog.category.name}
          error={error}
          onClose={onClose}
          onRemove={onRemoveCategoryLabel}
          onRename={onRenameCategoryLabel}
          summary={categoryLabelSummary}
        />
      ) : null}
      {dialog.kind === 'renameCategory' ? (
        <CategoryNameDialog
          actionLabel="Save"
          busy={busy}
          error={error}
          initialName={dialog.category.name}
          onClose={onClose}
          onSave={(name) => onRenameCategory(dialog.category, name)}
          title="Rename category"
        />
      ) : null}
      {dialog.kind === 'deleteCategory' ? (
        <ConfirmDialog
          actionLabel="Delete category"
          busy={busy}
          danger
          error={error}
          message={`Delete "${dialog.category.name}" and all videos in it? This removes the saved video files from disk.`}
          onClose={onClose}
          onConfirm={() => onDeleteCategory(dialog.category)}
          title="Delete category"
        />
      ) : null}
      {dialog.kind === 'deleteMedia' ? (
        <ConfirmDialog
          actionLabel="Delete video"
          busy={busy}
          danger
          error={error}
          message={`Delete "${dialog.item.title}" from the library?`}
          onClose={onClose}
          onConfirm={() => onDeleteMedia(dialog.item)}
          title="Delete video"
        />
      ) : null}
      {extensionDialog.kind !== 'none' ? (
        <ExtensionInstallDialog
          error={extensionError}
          job={extensionDialog.job}
          onCheckAgain={() => onCheckExtension(extensionDialog.job)}
          onClose={onCloseExtension}
          sourceExtensionProfile={sourceExtensionProfile}
          status={extensionDialog.status}
        />
      ) : null}
    </>
  );
}

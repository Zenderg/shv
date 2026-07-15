# Page Dependency Trees

This file is generated design context for Superdesign. It is the source of truth for local files that affect each user-facing render branch. The production app has one URL and two state-driven pages, so Library and Queue are documented separately.

## `/` — Library

Entry: `src/web/src/main.tsx`

Dependencies:

- `src/web/src/main.tsx`
  - `src/web/src/App.tsx`
    - `src/shared/sourceExtension.ts`
    - `src/web/src/components/AppHeader.tsx`
      - `src/web/src/components/icons.tsx`
      - `src/web/src/features/queue/queueSummary.ts`
        - `src/web/src/features/queue/queueStatus.ts`
        - `src/web/src/lib/api.ts`
    - `src/web/src/components/AppSidebar.tsx`
      - `src/web/src/components/CategoryActionsMenu.tsx`
      - `src/web/src/components/icons.tsx`
      - `src/web/src/lib/api.ts`
    - `src/web/src/components/AsyncStates.tsx`
    - `src/web/src/components/MobileNavigation.tsx`
      - `src/web/src/components/MobileHeader.tsx`
      - `src/web/src/components/CategoryActionsMenu.tsx`
      - `src/web/src/components/icons.tsx`
      - `src/web/src/lib/api.ts`
    - `src/web/src/features/app/AppDialogs.tsx`
      - `src/shared/sourceExtension.ts`
      - `src/web/src/features/dialogs/AddVideoDialog.tsx`
      - `src/web/src/features/dialogs/CategoryNameDialog.tsx`
      - `src/web/src/features/dialogs/ConfirmDialog.tsx`
      - `src/web/src/features/dialogs/EditDialog.tsx`
      - `src/web/src/features/dialogs/ExtensionInstallDialog.tsx`
      - `src/web/src/features/dialogs/PlayerDialog.tsx`
      - `src/web/src/components/DialogBackdrop.tsx`
      - `src/web/src/components/icons.tsx`
      - `src/web/src/lib/extensionBridge.ts`
      - `src/web/src/lib/api.ts`
      - `src/web/src/utils/format.ts`
    - `src/web/src/features/app/queries.ts`
      - `src/web/src/lib/api.ts`
    - `src/web/src/features/app/useQueueCompletionNotifications.ts`
      - `src/web/src/features/app/queueTransitions.ts`
      - `src/web/src/features/queue/CompletionToasts.tsx`
      - `src/web/src/lib/api.ts`
    - `src/web/src/features/library/LibraryGrid.tsx`
      - `src/web/src/components/MediaActionsMenu.tsx`
      - `src/web/src/components/icons.tsx`
      - `src/web/src/features/library/libraryVirtualization.ts`
      - `src/web/src/lib/api.ts`
      - `src/web/src/utils/format.ts`
    - `src/web/src/features/queue/CompletionToasts.tsx`
    - `src/web/src/lib/api.ts`
    - `src/web/src/lib/extensionBridge.ts`
    - `src/web/src/utils/format.ts`
  - `src/web/src/styles.css`
    - `src/web/src/styles/tokens.css`
    - `src/web/src/styles/base.css`
    - `src/web/src/styles/shell.css`
    - `src/web/src/styles/navigation.css`
    - `src/web/src/styles/forms.css`
    - `src/web/src/styles/surfaces.css`
    - `src/web/src/styles/library.css`
    - `src/web/src/styles/queue.css`
    - `src/web/src/styles/dialogs.css`
    - `src/web/src/styles/extension-dialog.css`
    - `src/web/src/styles/responsive.css`

Actual render branch: `App.renderLibrary()` renders loading/error states or `LibraryGrid`; `LibraryGrid` renders either `EmptyLibrary` or the virtualized card grid.

## `/` — Queue

Entry: `src/web/src/main.tsx`

Dependencies unique to this branch (all shared shell, dialogs, API, and stylesheet files from the Library tree also apply):

- `src/web/src/App.tsx`
  - `src/web/src/features/queue/QueuePanel.tsx`
    - `src/web/src/components/icons.tsx`
    - `src/web/src/features/queue/queueCardContext.ts`
      - `src/web/src/features/queue/queueStatus.ts`
      - `src/web/src/lib/api.ts`
    - `src/web/src/features/queue/queuePresentation.ts`
      - `src/web/src/features/queue/queueStatus.ts`
      - `src/web/src/lib/api.ts`
    - `src/web/src/lib/jobProgress.ts`
      - `src/web/src/lib/api.ts`
    - `src/web/src/lib/api.ts`
  - `src/web/src/features/queue/queueSummary.ts`
  - `src/web/src/features/queue/queueStatus.ts`

Actual render branch: `App.renderQueue()` renders loading/error/empty states or `QueuePanel`. Each queue card conditionally renders progress, attention/error notice, subtitle selection, and status-specific actions.

## Modal flows on `/`

Entry: `src/web/src/features/app/AppDialogs.tsx`

Dependencies:

- `src/web/src/features/dialogs/AddVideoDialog.tsx`
- `src/web/src/features/dialogs/CategoryNameDialog.tsx`
- `src/web/src/features/dialogs/ConfirmDialog.tsx`
- `src/web/src/features/dialogs/EditDialog.tsx`
- `src/web/src/features/dialogs/ExtensionInstallDialog.tsx`
- `src/web/src/features/dialogs/PlayerDialog.tsx`
- `src/web/src/components/DialogBackdrop.tsx`
- `src/web/src/components/icons.tsx`
- `src/web/src/styles/forms.css`
- `src/web/src/styles/dialogs.css`
- `src/web/src/styles/extension-dialog.css`
- `src/web/src/styles/surfaces.css`

## Extension source-sidebar preview

Entry: `src/extension-preview/main.ts`

Dependencies:

- `src/extension-preview/main.ts`
  - `src/extension-preview/PreviewApp.svelte`
    - `src/extension/source-helper/SourceSidebar.svelte`
      - `src/extension/source-helper/Diagnostics.svelte`
      - `src/extension/source-helper/ChevronLeftIcon.svelte`
      - `src/extension/source-helper/ChevronRightIcon.svelte`
      - `src/extension/source-helper/CloseIcon.svelte`
      - `src/extension/source-helper/candidateDisplay.ts`
      - `src/extension/source-helper/sidebarStore.ts`
      - `src/extension/source-helper/sourceSelection.ts`
    - `src/extension/source-helper/sidebarStyles.ts`
    - `src/extension/source-helper/sidebarStore.ts`
  - `src/extension-preview/preview.css`

Actual render branch: the harness mounts the real Svelte sidebar into a Shadow DOM host and switches among candidate, empty, listening, capturing, selected, long-URL, and no-job scenarios.

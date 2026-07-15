# Extractable Superdesign Components

This file catalogs project-owned UI patterns that are reusable in design drafts. Layout components are the best extraction candidates; small controls should remain inline so drafts can use the production CSS directly.

## AppSidebar

- Source: `src/web/src/components/AppSidebar.tsx`
- Category: layout
- Description: Persistent desktop brand, queue summary, and flat category navigation.
- Extractable props: `page` (string, default: `library`), `queueItemCount` (number, default: `0`), `selectedCategoryId` (string, default: `category-1`), `openCategoryMenuId` (string, default: ``)
- Hardcoded: shv mark, Queue and Categories labels, icon paths, CSS classes, app version placement

## AppHeader

- Source: `src/web/src/components/AppHeader.tsx`
- Category: layout
- Description: Desktop page title, summary, extension update action, and Add action.
- Extractable props: `page` (string, default: `library`), `categoryName` (string, default: `Library`), `mediaCount` (number, default: `0`), `activeProblems` (number, default: `0`), `extensionUpdateAvailable` (boolean, default: `false`)
- Hardcoded: action labels, Plus/Update icons, typography and CSS classes

## MobileHeader

- Source: `src/web/src/components/MobileHeader.tsx`
- Category: layout
- Description: Compact sticky header used at tablet and phone widths.
- Extractable props: `page` (string, default: `library`), `categoryName` (string, default: `Library`), `librarySummary` (string, default: `0 saved videos`), `queueSummary` (string, default: `Queue is empty`), `extensionUpdateAvailable` (boolean, default: `false`)
- Hardcoded: menu/add/update icons, Add label, CSS classes

## MobileNavigation

- Source: `src/web/src/components/MobileNavigation.tsx`
- Category: layout
- Description: Modal navigation drawer with queue status, category select, and selected-category actions.
- Extractable props: `page` (string, default: `library`), `queueItemCount` (number, default: `0`), `activeProblems` (number, default: `0`), `selectedCategoryId` (string, default: `category-1`), `drawerOpen` (boolean, default: `true`)
- Hardcoded: shv branding, mobile drawer structure, Category and Queue labels, icons and CSS classes

## VideoCard

- Source: `src/web/src/features/library/LibraryGrid.tsx`
- Category: basic
- Description: 16:9 video poster with play action, duration, title, technical metadata, and overflow menu.
- Extractable props: `showThumbnail` (boolean, default: `true`), `showDuration` (boolean, default: `true`), `showActions` (boolean, default: `true`)
- Hardcoded: card structure, play icon, duration placement, metadata layout and CSS classes

## QueueJob

- Source: `src/web/src/features/queue/QueuePanel.tsx`
- Category: basic
- Description: State-driven job card with status pill, destination, progress/notice, and contextual actions.
- Extractable props: `status` (string, default: `pending`), `showProgress` (boolean, default: `false`), `showNotice` (boolean, default: `false`), `showTechnicalDetails` (boolean, default: `false`)
- Hardcoded: status icon set, action hierarchy, notice structure, spacing and CSS classes

## DialogBackdrop

- Source: `src/web/src/components/DialogBackdrop.tsx`
- Category: layout
- Description: Full-screen modal overlay with Radix focus management and centered scroll-safe content.
- Extractable props: `open` (boolean, default: `true`)
- Hardcoded: overlay behavior, focus restoration and CSS class

## FormDialog

- Sources: `src/web/src/features/dialogs/AddVideoDialog.tsx`, `CategoryNameDialog.tsx`, `EditDialog.tsx`, `ConfirmDialog.tsx`
- Category: basic
- Description: Shared visual dialog pattern with title/close header, labeled fields, inline errors, and primary/secondary actions.
- Extractable props: `showError` (boolean, default: `false`), `busy` (boolean, default: `false`), `danger` (boolean, default: `false`)
- Hardcoded: 460/540px sizing, label/input rhythm, 42px controls, radius and color tokens

## SourceSidebar

- Source: `src/extension/source-helper/SourceSidebar.svelte`
- Category: layout
- Description: Light 390px injected browser sidebar for media-source discovery and selection.
- Extractable props: `collapsed` (boolean, default: `false`), `status` (string, default: `waiting for playback`), `candidateCount` (number, default: `2`), `capturePending` (boolean, default: `false`)
- Hardcoded: Sources title, candidate-card anatomy, diagnostics layout, icon components and Shadow DOM styles

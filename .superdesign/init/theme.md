# Theme and Visual Tokens

This file is generated design context for Superdesign. It contains the complete production web stylesheet entry point, all imported stylesheet modules, and the complete browser-extension sidebar styling. The project uses custom CSS rather than Tailwind or a component theme framework.

## Framework summary

- React 19 + Vite for the production web app.
- Svelte 5 inside the browser-extension source sidebar and its preview harness.
- Radix Dialog and Dropdown Menu provide accessible behavior; visual styling is project-owned CSS.
- Dark production web UI; light browser-extension sidebar so it remains legible over arbitrary source pages.
- Breakpoints: compact navigation at 1040px and single-column/tighter spacing at 680px.

## src/web/src/styles.css

```css
@import './styles/tokens.css';
@import './styles/base.css';
@import './styles/shell.css';
@import './styles/navigation.css';
@import './styles/forms.css';
@import './styles/surfaces.css';
@import './styles/library.css';
@import './styles/queue.css';
@import './styles/dialogs.css';
@import './styles/extension-dialog.css';
@import './styles/responsive.css';
```

## src/web/src/styles/tokens.css

```css
:root {
  --color-background: #101614;
  --color-sidebar: #0c1210;
  --color-sidebar-surface: #17211d;
  --color-surface: #18211e;
  --color-surface-raised: #202a26;
  --color-surface-muted: #26342f;
  --color-input: #121916;
  --color-border: #405149;
  --color-border-strong: #5c7167;
  --color-text: #eef4ee;
  --color-muted: #aebbb2;
  --color-subtle: #98a79d;
  --color-accent: #7bd68f;
  --color-accent-strong: #3aa875;
  --color-accent-contrast: #07130d;
  --color-focus: #9ae7a9;
  --color-danger-bg: #392018;
  --color-danger-border: #c06a4c;
  --color-danger-text: #ffb69f;
  --color-warning-bg: #332515;
  --color-warning-border: #b57a36;
  --color-warning-text: #f7c684;
  --shadow-panel: 0 18px 46px rgba(0, 0, 0, 0.26);
  --shadow-card: 0 14px 28px rgba(0, 0, 0, 0.18);
  color: var(--color-text);
  background: var(--color-background);
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}
```

## src/web/src/styles/base.css

```css
* {
  box-sizing: border-box;
}

body {
  background: var(--color-background);
  color: var(--color-text);
  margin: 0;
  min-width: 320px;
}

button,
input,
select {
  font: inherit;
}

button {
  align-items: center;
  border: 0;
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:where(button, a, input, select, summary):focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}

.srOnly {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

svg {
  display: block;
  fill: currentColor;
  height: 20px;
  width: 20px;
}

h1,
h2,
p {
  margin: 0;
}
```

## src/web/src/styles/shell.css

```css
.shell {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  height: 100vh;
  overflow: hidden;
}

.workspace {
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 32px;
}

.topbar {
  align-items: end;
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(220px, 1fr) auto;
  margin-bottom: 24px;
}

h1 {
  font-size: clamp(28px, 3vw, 42px);
  line-height: 1.04;
}

.topbar p,
.videoMeta p,
.muted,
.queueJob span {
  color: var(--color-subtle);
}

.topbarActions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.extensionUpdateButton {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  color: var(--color-warning-text);
  font-weight: 700;
  min-height: 46px;
  padding: 0 16px;
}

.primaryButton {
  background: var(--color-accent-strong);
  border-radius: 6px;
  color: var(--color-accent-contrast);
  font-weight: 700;
  min-height: 46px;
  padding: 0 18px;
}

.inlineNotice {
  align-items: center;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 8px;
  color: var(--color-warning-text);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 11px 13px;
}

.inlineNotice[data-tone='danger'] {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

.inlineNotice button {
  background: var(--color-surface-muted);
  border-radius: 6px;
  color: var(--color-text);
  min-height: 36px;
  padding: 0 12px;
}

.loadErrorState {
  align-content: center;
  background: var(--color-surface);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  justify-items: start;
  min-height: 260px;
  padding: 28px;
}

.loadErrorState p {
  color: var(--color-muted);
  line-height: 1.5;
}

.error {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  color: var(--color-danger-text);
  margin-bottom: 16px;
  padding: 12px 14px;
}
```

## src/web/src/styles/navigation.css

```css
.sidebar {
  background: var(--color-sidebar);
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 18px;
}

.brand {
  align-items: center;
  display: flex;
  gap: 12px;
}

.brand svg {
  color: var(--color-accent);
  height: 38px;
  width: 38px;
}

.brand strong,
.brand span {
  display: block;
}

.brand span {
  color: var(--color-muted);
  font-size: 13px;
  margin-top: 2px;
}

.queueNav,
.categoryNav {
  display: grid;
  gap: 6px;
}

.categorySection {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.categoryHeader {
  align-items: center;
  color: var(--color-subtle);
  display: flex;
  font-size: 12px;
  font-weight: 800;
  justify-content: space-between;
  letter-spacing: 0;
  padding: 0 4px 0 10px;
  text-transform: uppercase;
}

.categoryHeader button {
  background: var(--color-sidebar-surface);
  border-radius: 8px;
  color: var(--color-text);
  height: 36px;
  justify-content: center;
  padding: 0;
  width: 36px;
}

.categoryHeader button:hover,
.categoryHeader button:focus-visible {
  background: var(--color-surface-muted);
  color: var(--color-accent);
}

.queueNav {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 18px;
}

.queueNav button,
.categoryLink {
  background: transparent;
  border-radius: 8px;
  color: var(--color-muted);
  justify-content: flex-start;
  min-height: 42px;
  padding: 10px;
  text-align: left;
}

.queueNav button.selected,
.queueNav button:hover,
.categoryNavItem.selected,
.categoryNavItem:hover {
  background: var(--color-sidebar-surface);
  color: var(--color-text);
}

.categoryNavItem {
  align-items: center;
  border-radius: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  position: relative;
}

.categoryLink {
  min-width: 0;
  width: 100%;
}

.categoryLink span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.categoryMenuButton {
  background: transparent;
  border-radius: 6px;
  color: var(--color-muted);
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;
}

.categoryMenuButton[data-state="open"] {
  color: var(--color-text);
}

.categoryNavItem.selected .categoryLink,
.categoryNavItem.selected .categoryMenuButton,
.categoryNavItem:hover .categoryLink,
.categoryNavItem:hover .categoryMenuButton,
.categoryMenuButton:hover {
  color: var(--color-text);
}

.actionsMenu {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-panel);
  display: grid;
  gap: 4px;
  padding: 4px;
  width: 164px;
  z-index: 60;
}

.actionsMenuItem {
  align-items: center;
  background: transparent;
  border-radius: 6px;
  color: var(--color-text);
  cursor: pointer;
  display: flex;
  justify-content: flex-start;
  min-height: 36px;
  outline: none;
  padding: 0 10px;
  width: 100%;
}

.actionsMenuItem[data-highlighted] {
  background: var(--color-surface-muted);
}

.actionsMenuItem.dangerMenuItem {
  color: var(--color-danger-text);
}

.navBadge {
  background: var(--color-accent);
  border-radius: 999px;
  color: var(--color-accent-contrast);
  font-size: 12px;
  line-height: 1;
  margin-left: auto;
  min-width: 24px;
  padding: 5px 7px;
  text-align: center;
}

.mobileNavigation {
  display: none;
}

.mobileHeader {
  align-items: center;
  background: color-mix(in srgb, var(--color-sidebar) 94%, transparent);
  border-bottom: 1px solid var(--color-border);
  display: grid;
  gap: 10px;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  min-height: 66px;
  padding: 10px 16px;
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}

.mobileHeaderIconButton,
.mobileExtensionUpdateButton,
.mobileDrawerClose,
.mobileCategoryMenuButton {
  background: var(--color-sidebar-surface);
  border-radius: 8px;
  color: var(--color-text);
  height: 42px;
  justify-content: center;
  padding: 0;
  width: 42px;
}

.mobileHeaderIconButton:hover,
.mobileHeaderIconButton:focus-visible,
.mobileExtensionUpdateButton:hover,
.mobileExtensionUpdateButton:focus-visible,
.mobileDrawerClose:hover,
.mobileDrawerClose:focus-visible,
.mobileCategoryMenuButton:hover,
.mobileCategoryMenuButton:focus-visible,
.mobileCategoryMenuButton[data-state="open"] {
  background: var(--color-surface-muted);
  color: var(--color-accent);
}

.mobileExtensionUpdateButton {
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning-text);
}

.mobileHeaderTitle {
  min-width: 0;
}

.mobileHeaderTitle h1,
.mobileHeaderTitle span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobileHeaderTitle h1 {
  font-size: 16px;
}

.mobileHeaderTitle span {
  color: var(--color-subtle);
  font-size: 12px;
  margin-top: 2px;
}

.mobileHeaderActions {
  display: flex;
  gap: 8px;
}

.mobileAddButton {
  background: var(--color-accent-strong);
  border-radius: 8px;
  color: var(--color-accent-contrast);
  font-weight: 800;
  min-height: 42px;
  padding: 0 14px;
}

.mobileDrawerOverlay {
  background: rgba(3, 6, 5, 0.74);
  inset: 0;
  position: fixed;
  z-index: 40;
}

.mobileDrawer {
  background: var(--color-sidebar);
  border-right: 1px solid var(--color-border);
  box-shadow: var(--shadow-panel);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  inset: 0 auto 0 0;
  max-width: calc(100vw - 28px);
  outline: none;
  position: fixed;
  width: 390px;
  z-index: 41;
}

.mobileDrawerHeader {
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  gap: 14px;
  justify-content: space-between;
  padding: 16px;
}

.mobileDrawerBrand {
  align-items: center;
  display: flex;
  gap: 12px;
  min-width: 0;
}

.mobileDrawerBrand > svg {
  color: var(--color-accent);
  height: 36px;
  width: 36px;
}

.mobileDrawerBrand h2,
.mobileDrawerBrand p {
  margin: 0;
}

.mobileDrawerBrand h2 {
  font-size: 18px;
}

.mobileDrawerBrand p {
  color: var(--color-subtle);
  font-size: 12px;
  margin-top: 2px;
}

.mobileDrawerBody {
  align-content: start;
  display: grid;
  gap: 22px;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.mobileQueueShortcut {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-muted);
  display: grid;
  gap: 10px;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  min-height: 58px;
  padding: 10px 12px;
  text-align: left;
  width: 100%;
}

.mobileQueueShortcut:hover,
.mobileQueueShortcut:focus-visible,
.mobileQueueShortcut.selected {
  background: var(--color-sidebar-surface);
  color: var(--color-text);
}

.mobileQueueShortcut > span {
  min-width: 0;
}

.mobileQueueShortcut strong,
.mobileQueueShortcut small {
  display: block;
}

.mobileQueueShortcut small {
  color: var(--color-subtle);
  font-size: 12px;
  margin-top: 3px;
}

.mobileCategorySection {
  display: grid;
  gap: 14px;
}

.mobileCategoryHeader {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.mobileCategoryHeader > span,
.mobileCategorySelect > span,
.mobileSelectedCategory span {
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.mobileCategoryHeader button {
  background: var(--color-sidebar-surface);
  border-radius: 8px;
  color: var(--color-text);
  font-weight: 700;
  min-height: 38px;
  padding: 0 12px;
}

.mobileCategorySelect {
  display: grid;
  gap: 7px;
}

.mobileCategorySelect select {
  background: var(--color-input);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-text);
  min-height: 46px;
  min-width: 0;
  padding: 0 12px;
  width: 100%;
}

.mobileSelectedCategory {
  align-items: center;
  background: var(--color-sidebar-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) 42px;
  padding: 10px;
}

.mobileSelectedCategory div,
.mobileSelectedCategory strong,
.mobileSelectedCategory span {
  display: block;
  min-width: 0;
}

.mobileSelectedCategory strong {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

## src/web/src/styles/forms.css

```css
.categoryMode {
  background: var(--color-input);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 4px;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
}

.formDialog input,
.formDialog select {
  background: var(--color-input);
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  color: var(--color-text);
  min-height: 42px;
  min-width: 0;
  padding: 0 12px;
}

.formDialog button[type="submit"],
.jobActions button {
  background: var(--color-accent-strong);
  border-radius: 6px;
  color: var(--color-accent-contrast);
  font-weight: 700;
  min-height: 42px;
  padding: 0 16px;
}

.inlineDialogError {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  color: var(--color-danger-text);
  font-size: 13px;
  line-height: 1.45;
  margin: 0;
  padding: 10px 12px;
}

.formDialog button.dangerButton[type="submit"],
.dialogActions .dangerButton {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
}

.dialogActions .secondaryButton {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.categoryMode button {
  background: transparent;
  border-radius: 6px;
  color: var(--color-muted);
  justify-content: center;
  min-height: 38px;
  padding: 0 12px;
}

.categoryMode button.selected {
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 700;
}
```

## src/web/src/styles/surfaces.css

```css
.videoCard,
.emptyState,
.queueJob,
.formDialog,
.playerDialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-panel);
}

.mediaActionsButton,
.playerDialog header button,
.formDialog header button {
  background: var(--color-surface-muted);
  border-radius: 6px;
  color: var(--color-text);
  height: 42px;
  justify-content: center;
  padding: 0;
  width: 42px;
}
```

## src/web/src/styles/library.css

```css
.libraryGrid {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.virtualLibrary {
  min-height: 1px;
  width: 100%;
}

.virtualLibraryCanvas {
  position: relative;
  width: 100%;
}

.virtualLibraryRow,
.virtualLibraryStatusRow {
  display: grid;
  gap: 18px;
  left: 0;
  padding-bottom: 18px;
  position: absolute;
  top: 0;
  width: 100%;
}

.libraryLoadStatus {
  align-items: center;
  color: var(--color-muted);
  display: flex;
  gap: 12px;
  justify-content: center;
  min-height: 64px;
  text-align: center;
}

.libraryLoadStatus .secondaryButton {
  background: var(--color-surface-muted);
  border-radius: 6px;
  color: var(--color-text);
  min-height: 40px;
  padding: 0 14px;
}

.videoCard {
  box-shadow: var(--shadow-card);
  display: grid;
  overflow: hidden;
}

.poster {
  aspect-ratio: 16 / 9;
  background:
    radial-gradient(circle at 22% 18%, rgba(123, 214, 143, 0.16), transparent 30%),
    linear-gradient(135deg, #26342f, #141d19);
  color: var(--color-accent);
  display: block;
  overflow: hidden;
  padding: 0;
  position: relative;
  width: 100%;
}

.poster img {
  display: block;
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.posterPlaceholder {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  position: absolute;
}

.playBadge,
.durationBadge {
  position: absolute;
  z-index: 1;
}

.playBadge {
  align-items: center;
  background: rgba(7, 19, 13, 0.62);
  border: 1px solid rgba(238, 244, 238, 0.18);
  border-radius: 999px;
  color: var(--color-text);
  display: flex;
  height: 52px;
  justify-content: center;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 52px;
}

.playBadge svg {
  height: 26px;
  transform: translateX(1px);
  width: 26px;
}

.durationBadge {
  background: rgba(3, 6, 5, 0.78);
  border-radius: 6px;
  bottom: 12px;
  color: var(--color-text);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  padding: 6px 8px;
  right: 12px;
}

.videoMeta {
  display: grid;
  gap: 6px;
  padding: 14px 64px 14px 14px;
  position: relative;
}

.videoMeta h2 {
  display: -webkit-box;
  font-size: 17px;
  line-height: 1.25;
  min-height: 2.5em;
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.videoMeta p {
  font-size: 13px;
}

.mediaActionsButton {
  bottom: 12px;
  position: absolute;
  right: 12px;
}

.mediaActionsButton:hover,
.mediaActionsButton:focus-visible,
.mediaActionsButton[data-state="open"] {
  background: var(--color-border-strong);
}

.emptyState {
  align-content: center;
  color: var(--color-subtle);
  display: grid;
  justify-items: center;
  min-height: 420px;
  padding: 32px;
  text-align: center;
}

.emptyState svg {
  color: var(--color-accent);
  height: 64px;
  margin-bottom: 12px;
  width: 64px;
}

.emptyState h2 {
  color: var(--color-text);
  font-size: 24px;
  margin-bottom: 8px;
}

.emptyState p {
  line-height: 1.5;
  max-width: 540px;
}

.emptyStateActions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 18px;
}

.emptyStateActions .secondaryButton {
  background: var(--color-surface-muted);
  border-radius: 6px;
  color: var(--color-text);
  font-weight: 700;
  min-height: 46px;
  padding: 0 18px;
}

.compactEmptyState {
  min-height: 320px;
}

.skeletonCard,
.skeletonQueueCard {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  overflow: hidden;
  padding: 14px;
}

.skeletonPoster {
  aspect-ratio: 16 / 9;
  background: var(--color-surface-muted);
  display: block;
  margin: -14px -14px 4px;
}

.skeletonLine,
.skeletonBar {
  background: var(--color-surface-muted);
  border-radius: 999px;
  display: block;
  height: 12px;
  width: 52%;
}

.skeletonLine.wide {
  height: 16px;
  width: 82%;
}

.skeletonQueueCard {
  min-height: 130px;
  padding: 18px;
}

.skeletonBar {
  height: 8px;
  margin-top: 10px;
  width: 100%;
}
```

## src/web/src/styles/queue.css

```css
.queueList {
  display: grid;
  gap: 12px;
  max-width: 1040px;
}

.queueEmpty {
  padding: 10px 0;
}

.queueJob {
  box-shadow: none;
  display: grid;
  gap: 12px;
  padding: 14px;
}

.queueJob[data-tone='active'] {
  border-inline-start: 3px solid var(--color-accent-strong);
}

.queueJob[data-tone='attention'] {
  border-inline-start: 3px solid var(--color-warning-border);
}

.queueJob[data-tone='danger'] {
  border-inline-start: 3px solid var(--color-danger-border);
}

.jobHeader {
  align-items: start;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) auto;
}

.jobTitle {
  display: -webkit-box;
  font-size: 16px;
  line-height: 1.3;
  margin: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.jobStatus {
  align-items: center;
  border: 1px solid var(--color-border-strong);
  border-radius: 999px;
  color: var(--color-muted);
  display: inline-flex;
  font-size: 12px;
  font-weight: 800;
  gap: 6px;
  line-height: 1.2;
  min-height: 28px;
  padding: 4px 9px;
  white-space: nowrap;
}

.jobStatus svg {
  height: 15px;
  width: 15px;
}

.jobStatus[data-tone='active'] {
  background: rgba(58, 168, 117, 0.12);
  border-color: var(--color-accent-strong);
  color: var(--color-accent);
}

.jobStatus[data-tone='attention'] {
  background: var(--color-warning-bg);
  border-color: var(--color-warning-border);
  color: var(--color-warning-text);
}

.jobStatus[data-tone='danger'] {
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

.jobContext {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0;
}

.jobContext > div {
  align-items: baseline;
  display: flex;
  gap: 6px;
  min-width: 0;
}

.jobContext dt {
  color: var(--color-subtle);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.jobContext dd {
  color: var(--color-muted);
  font-size: 12px;
  margin: 0;
  overflow-wrap: anywhere;
}

.progressStack {
  display: grid;
  gap: 8px;
}

.progressRow {
  display: grid;
  gap: 5px;
}

.progressRow > div {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.progressRow span {
  color: var(--color-subtle);
  font-size: 12px;
}

.progressRow strong {
  color: var(--color-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.progressRow progress {
  accent-color: var(--color-accent-strong);
  height: 8px;
  width: 100%;
}

.jobNotice {
  background: color-mix(in srgb, var(--color-surface-muted) 58%, var(--color-surface));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 6px;
  padding: 12px;
}

.jobNotice[data-tone='attention'] {
  background: color-mix(in srgb, var(--color-warning-bg) 62%, var(--color-surface));
  border-color: var(--color-warning-border);
  color: var(--color-warning-text);
}

.jobNotice[data-tone='danger'] {
  background: color-mix(in srgb, var(--color-danger-bg) 62%, var(--color-surface));
  border-color: var(--color-danger-border);
  color: var(--color-danger-text);
}

.jobNotice p {
  color: inherit;
  font-size: 13px;
  line-height: 1.45;
  margin: 0;
}

.jobNotice details {
  border-top: 1px solid var(--color-border-strong);
  margin-top: 4px;
  padding-top: 8px;
}

.jobNotice summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  width: fit-content;
}

.jobNotice pre {
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid currentColor;
  border-radius: 6px;
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.45;
  margin: 10px 0 0;
  max-height: 180px;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: 10px;
  white-space: pre-wrap;
}

.jobActionStatus {
  color: var(--color-muted);
  font-size: 13px;
  margin: 0;
}

.jobActionError {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  color: var(--color-danger-text);
  font-size: 13px;
  margin: 0;
  padding: 10px 12px;
}

.jobActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.jobActions button,
.subtitleSelection button {
  border-radius: 6px;
  font-weight: 700;
  min-height: 42px;
  padding: 0 16px;
}

.jobActions .queuePrimaryAction,
.subtitleSelection .queuePrimaryAction {
  background: var(--color-accent-strong);
  color: var(--color-accent-contrast);
}

.jobActions .queueSecondaryAction {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.jobActions .dangerButton {
  background: transparent;
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
}

.subtitleSelection {
  align-items: end;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(180px, 1fr) auto;
  padding: 10px;
}

.subtitleSelection label {
  color: var(--color-muted);
  display: grid;
  font-size: 12px;
  font-weight: 700;
  gap: 6px;
}

.subtitleSelection select {
  min-width: 0;
}

.queueProgressContext {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.completionToasts {
  bottom: 20px;
  display: grid;
  gap: 10px;
  max-width: min(420px, calc(100vw - 32px));
  position: fixed;
  right: 20px;
  width: 100%;
  z-index: 35;
}

.completionToast {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-accent-strong);
  border-radius: 10px;
  box-shadow: var(--shadow-panel);
  display: grid;
  gap: 12px;
  padding: 14px;
}

.completionToast > div:first-child {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.completionToast p {
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.completionToastActions {
  display: flex;
  gap: 8px;
}

.completionToastActions button {
  border-radius: 6px;
  min-height: 40px;
}

.completionOpenButton {
  background: var(--color-accent-strong);
  color: var(--color-accent-contrast);
  font-weight: 700;
  justify-content: center;
  padding: 0 14px;
}

.completionDismissButton {
  background: var(--color-surface-muted);
  color: var(--color-text);
  justify-content: center;
  padding: 0;
  width: 40px;
}

@media (max-width: 680px) {
  .jobHeader {
    grid-template-columns: 1fr;
  }

  .jobStatus {
    justify-self: start;
  }

  .subtitleSelection {
    grid-template-columns: 1fr;
  }

  .completionToasts {
    bottom: 12px;
    max-height: min(50dvh, 360px);
    max-width: calc(100vw - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    right: 12px;
  }
}
```

## src/web/src/styles/dialogs.css

```css
.dialogBackdrop {
  align-items: flex-start;
  background: rgba(3, 6, 5, 0.74);
  display: flex;
  inset: 0;
  justify-content: center;
  overflow-y: auto;
  padding: 24px;
  position: fixed;
  z-index: 70;
}

.dialogBackdrop > [role='dialog'] {
  flex-shrink: 0;
  margin-block: auto;
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
}

.playerDialog {
  max-height: min(880px, calc(100vh - 48px));
  overflow: auto;
  width: min(1120px, 100%);
}

.playerDialog header,
.formDialog header {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 18px;
}

.playerDialog video {
  background: #000000;
  display: block;
  max-height: calc(100vh - 150px);
  width: 100%;
}

.formDialog {
  display: grid;
  gap: 16px;
  padding: 18px;
  width: min(460px, 100%);
}

.addVideoDialog {
  width: min(540px, 100%);
}

.confirmDialog > p:not(.inlineDialogError) {
  color: var(--color-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.dialogActions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.dialogActions button {
  border-radius: 6px;
  font-weight: 700;
  min-height: 42px;
  padding: 0 16px;
}

.formDialog header {
  padding: 0;
}

.formDialog header p {
  color: var(--color-subtle);
  font-size: 14px;
  margin-top: 4px;
}

.formDialog label {
  display: grid;
  gap: 8px;
  font-weight: 700;
}
```

## src/web/src/styles/extension-dialog.css

```css
.extensionDialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-panel);
  display: grid;
  max-height: min(760px, calc(100vh - 48px));
  overflow: auto;
  width: min(620px, 100%);
}

.extensionDialog header {
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 18px;
}

.extensionDialog header p {
  color: var(--color-subtle);
  font-size: 13px;
  margin-top: 4px;
  overflow-wrap: anywhere;
}

.extensionDialog header button {
  background: var(--color-surface-muted);
  border-radius: 6px;
  color: var(--color-text);
  height: 38px;
  justify-content: center;
  padding: 0;
  width: 38px;
}

.extensionDialogBody {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.extensionDialogBody > p:not(.inlineDialogError) {
  color: var(--color-muted);
  line-height: 1.5;
}

.extensionVersionBox {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: grid;
  gap: 8px 14px;
  grid-template-columns: minmax(130px, 1fr) auto;
  padding: 14px;
}

.extensionVersionBox span {
  color: var(--color-subtle);
}

.extensionVersionBox strong {
  color: var(--color-text);
}

.extensionDialog ol {
  color: var(--color-muted);
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
}

.extensionDialog code {
  background: var(--color-surface-muted);
  border-radius: 4px;
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 2px 4px;
}

.extensionId {
  font-size: 13px;
}

.extensionId code {
  overflow-wrap: anywhere;
}

.extensionDialog footer {
  background: var(--color-surface-raised);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  padding: 14px 18px;
}

.extensionDialog footer button,
.downloadButton {
  align-items: center;
  border-radius: 6px;
  display: inline-flex;
  font-weight: 800;
  min-height: 42px;
  padding: 0 16px;
  text-decoration: none;
}

.downloadButton {
  background: var(--color-accent-strong);
  color: var(--color-accent-contrast);
}

.extensionDialog footer button {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
```

## src/web/src/styles/responsive.css

```css
@media (max-width: 1040px) {
  .shell,
  .topbar {
    grid-template-columns: 1fr;
  }

  .mobileNavigation {
    display: block;
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .shell > .sidebar,
  .topbar {
    display: none;
  }

  .shell {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }

  .workspace {
    overflow-y: auto;
  }
}

@media (max-width: 680px) {
  .workspace,
  .sidebar {
    padding: 18px;
  }

  .libraryGrid {
    grid-template-columns: 1fr;
  }

  .topbar {
    align-items: stretch;
  }

  .mobileHeader {
    padding-inline: 12px;
  }

  h1 {
    font-size: 32px;
  }

  .subtitleSelection {
    grid-template-columns: 1fr;
  }

  .topbarActions {
    justify-content: stretch;
  }

  .primaryButton {
    justify-content: center;
    width: 100%;
  }

  .dialogBackdrop {
    padding: 12px;
  }
}
```

## src/extension/source-helper/sidebarStyles.ts

```ts
export const SIDEBAR_WIDTH = 390;
export const SIDEBAR_COLLAPSED_WIDTH = 48;
export const HIGHLIGHT_PADDING = 8;

export function sidebarCss() {
  return `
    :host {
      all: initial;
      color: #17211d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .panel {
      background: #f8faf6;
      border-left: 1px solid rgba(23, 33, 29, 0.12);
      box-shadow: -14px 0 32px rgba(15, 23, 42, 0.18);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      height: 100vh;
      overflow: hidden;
      width: min(100vw, ${SIDEBAR_WIDTH}px);
    }

    .panel.collapsed {
      align-items: start;
      background: #ffffff;
      grid-template-rows: auto auto 1fr;
      justify-items: center;
      row-gap: 18px;
      width: ${SIDEBAR_COLLAPSED_WIDTH}px;
    }

    .rail-label {
      color: #64716b;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      margin-top: 0;
      text-orientation: mixed;
      white-space: nowrap;
      writing-mode: vertical-rl;
    }

    header {
      align-items: start;
      background: #ffffff;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 18px 16px 14px;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      color: #17211d;
      font-size: 28px;
      letter-spacing: 0;
      line-height: 1;
    }

    header p,
    .job span,
    .source p,
    .empty p {
      color: #64716b;
    }

    .icon-button {
      align-items: center;
      background: #edf2ee;
      border: 0;
      border-radius: 999px;
      color: #17211d;
      cursor: pointer;
      display: inline-flex;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .icon-button svg,
    .collapse-button svg {
      display: block;
      height: 16px;
      width: 16px;
    }

    .header-actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .collapse-button {
      align-items: center;
      background: #21362e;
      border: 0;
      border-radius: 999px;
      color: #ffffff;
      cursor: pointer;
      display: inline-flex;
      font: 900 15px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .rail-button {
      margin-top: 18px;
    }

    .session-meta {
      min-width: 0;
    }

    .job {
      background: #ffffff;
      border-top: 1px solid rgba(23, 33, 29, 0.08);
      display: grid;
      gap: 7px;
      padding: 12px 16px;
    }

    .job strong,
    .job span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .capture-button {
      background: #21362e;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 34px;
    }

    .capture-button:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }

    .capture-button.capturing:disabled {
      cursor: progress;
    }

    .sources {
      align-content: start;
      display: grid;
      gap: 10px;
      min-height: 0;
      overflow: auto;
      padding: 12px;
    }

    .source {
      align-content: start;
      align-self: start;
      background: #ffffff;
      border-radius: 8px;
      display: grid;
      gap: 8px;
      min-width: 0;
      padding: 12px;
      transition: box-shadow 120ms ease, transform 120ms ease;
    }

    .source.is-highlighted {
      box-shadow: inset 0 0 0 2px #23d18b, 0 8px 22px rgba(30, 111, 85, 0.16);
      transform: translateX(-2px);
    }

    .source.is-selected {
      box-shadow: inset 0 0 0 2px #1e6f55;
    }

    .source-top {
      align-items: center;
      display: flex;
      justify-content: space-between;
    }

    .source-top strong {
      color: #17211d;
      font-size: 14px;
    }

    .source-top span {
      background: #e7f4de;
      border-radius: 999px;
      color: #24593f;
      font-size: 12px;
      font-weight: 800;
      padding: 5px 7px;
    }

    .source p {
      font-size: 12px;
    }

    .subtitle-status {
      background: #f3f4f6;
      border: 1px solid rgba(55, 65, 81, 0.16);
      border-radius: 6px;
      color: #4b5563;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.25;
      padding: 6px 8px;
    }

    .subtitle-status.has-subtitles {
      background: #e7f4de;
      border-color: rgba(36, 89, 63, 0.24);
      color: #24593f;
    }

    .source code {
      color: #44524b;
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.35;
      max-height: 92px;
      overflow: auto;
      overflow-wrap: anywhere;
    }

    .source button {
      background: #1e6f55;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 40px;
    }

    .source button:disabled {
      cursor: not-allowed;
      opacity: 0.62;
    }

    .selection-error {
      background: #fee2e2;
      border-top: 1px solid rgba(127, 29, 29, 0.14);
      color: #7f1d1d;
      font-size: 13px;
      font-weight: 700;
      padding: 10px 16px;
    }

    .empty {
      background: #fff7ed;
      color: #7c2d12;
      display: grid;
      gap: 8px;
      padding: 14px;
    }

    .empty p {
      color: #8c4a24;
      font-size: 13px;
    }

    .diagnostics {
      background: #eef5ff;
      color: #19324d;
      display: grid;
      gap: 6px;
      padding: 12px;
    }

    .diagnostics strong {
      font-size: 13px;
    }

    .diagnostics p {
      align-items: start;
      display: grid;
      gap: 6px;
      grid-template-columns: 92px 1fr;
      margin: 0;
    }

    .diagnostics span {
      color: #4b6178;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .diagnostics code {
      color: #19324d;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }

  `;
}
```

## src/extension-preview/preview.css

```css
* {
  box-sizing: border-box;
}

html,
body,
#app {
  min-height: 100%;
}

body {
  background: #edf1eb;
  color: #17211d;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
}

button {
  font: inherit;
}

main {
  min-height: 100vh;
  padding: 22px 430px 22px 22px;
}

.previewControls {
  align-items: start;
  display: grid;
  column-gap: 14px;
  grid-template-areas:
    "intro toolbar"
    "scenarios scenarios";
  grid-template-columns: minmax(220px, 1fr) auto;
  row-gap: 12px;
  margin-bottom: 18px;
  position: relative;
  z-index: 2;
}

.previewIntro {
  grid-area: intro;
}

.scenarioButtons {
  grid-area: scenarios;
}

.toolbar {
  grid-area: toolbar;
}

.previewControls h1,
.previewControls p,
.mockMeta h2,
.mockMeta p {
  margin: 0;
}

.previewControls h1 {
  font-size: 22px;
  line-height: 1.1;
}

.previewControls p {
  color: #5d6b64;
  font-size: 13px;
  margin-top: 4px;
}

.scenarioButtons,
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.scenarioButtons {
  justify-content: start;
}

.toolbar {
  justify-content: end;
}

.scenarioButtons button,
.toolbar button {
  background: #ffffff;
  border: 1px solid rgba(23, 33, 29, 0.14);
  border-radius: 6px;
  color: #24362f;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  min-height: 34px;
  padding: 0 11px;
}

.scenarioButtons button.active {
  background: #21362e;
  border-color: #21362e;
  color: #ffffff;
}

.mockPage {
  background: #f7f8f4;
  border: 1px solid rgba(23, 33, 29, 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.12);
  min-height: calc(100vh - 92px);
  overflow: hidden;
  position: relative;
}

.mockHeader {
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid rgba(23, 33, 29, 0.1);
  display: flex;
  justify-content: space-between;
  padding: 14px 18px;
}

.mockHeader strong {
  font-size: 14px;
}

.mockHeader span {
  color: #69746f;
  font-size: 13px;
  font-weight: 700;
}

.mockVideo {
  align-items: center;
  background:
    linear-gradient(135deg, rgba(33, 54, 46, 0.88), rgba(30, 111, 85, 0.72)),
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 12px, transparent 12px 24px);
  display: flex;
  justify-content: center;
  min-height: min(58vh, 520px);
  position: relative;
}

.playButton {
  align-items: center;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 999px;
  color: #21362e;
  display: flex;
  font-size: 13px;
  font-weight: 900;
  height: 72px;
  justify-content: center;
  width: 72px;
}

.mediaHighlight {
  background: rgba(35, 209, 139, 0.12);
  border: 3px solid #23d18b;
  border-radius: 14px;
  bottom: 28px;
  box-shadow: 0 0 0 9999px rgba(6, 12, 10, 0.16), 0 0 0 6px rgba(35, 209, 139, 0.18);
  display: none;
  left: 28px;
  pointer-events: none;
  position: absolute;
  right: 28px;
  top: 28px;
}

.mediaHighlight.visible {
  display: block;
}

.mediaHighlight span {
  background: #1e6f55;
  border-radius: 999px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  left: 12px;
  padding: 8px 10px;
  position: absolute;
  top: 12px;
}

.mockMeta {
  display: grid;
  gap: 7px;
  padding: 22px;
}

.mockMeta h2 {
  font-size: 26px;
  line-height: 1.15;
}

.mockMeta p {
  color: #5d6b64;
  font-size: 15px;
}

.sidebarHost {
  bottom: 0;
  pointer-events: auto;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 2147483647;
}

@media (max-width: 900px) {
  main {
    padding: 14px;
  }

  .previewControls {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .scenarioButtons {
    justify-content: start;
  }
}

@media (max-width: 520px) {
  .previewControls {
    grid-template-areas:
      "intro"
      "scenarios"
      "toolbar";
    grid-template-columns: 1fr;
  }

  .toolbar {
    justify-content: start;
  }
}
```

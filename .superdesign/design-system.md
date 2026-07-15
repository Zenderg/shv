# shv Design System

This document is the design source of truth for future Superdesign drafts. It describes the current shipped interface; proposed improvements must be presented as variations and must not silently replace these rules.

## Product context

shv is a personal, self-hosted video library and downloader for one trusted user on a home LAN or VPN. The interface prioritizes fast touch-friendly library browsing, obvious download recovery, and clear source-selection states over marketing content or multi-user administration.

Primary user jobs:

- Browse saved videos within one flat category.
- Play, rename, move, or delete a saved video.
- Add a URL to an existing or new category.
- Monitor active jobs and recover jobs that need attention.
- Install/update the helper extension and select a source when automatic discovery is insufficient.

## Information architecture

- One production URL with state-driven Library and Queue views.
- Desktop: fixed 260px sidebar, scrollable workspace, page header and actions.
- Tablet/phone at 1040px and below: 66px sticky mobile header plus modal navigation drawer.
- Phone at 680px and below: 18px workspace padding and a one-column library.
- Library cards use a responsive/virtualized grid with a 280px preferred minimum width and an 18px gap.
- Queue cards form a single column capped at 1040px.
- Dialogs are centered, scroll-safe, and use Radix focus management.
- Layer order keeps sticky navigation below drawers/menus and all app modals above the mobile header.

## Brand and visual character

- Product name: `shv` in lowercase.
- Brand mark: rounded square containing a play triangle from `src/web/src/components/icons.tsx`.
- Character: calm, utilitarian, media-focused, dark and low-glare; compact but not dense.
- Avoid decorative gradients outside media placeholders/thumbnails. Do not introduce neon, purple, or unrelated accent colors.
- Use project-owned icons and the real shv mark. Do not replace them with generic logo placeholders.

## Color tokens

Production web UI:

| Token | Value | Use |
| --- | --- | --- |
| background | `#101614` | Workspace background |
| sidebar | `#0c1210` | Desktop/mobile navigation |
| sidebar surface | `#17211d` | Selected/hovered navigation |
| surface | `#18211e` | Cards and dialogs |
| raised surface | `#202a26` | Menus, dialog footers, toasts |
| muted surface | `#26342f` | Secondary controls |
| input | `#121916` | Inputs/selects |
| border | `#405149` | Standard dividers and card borders |
| strong border | `#5c7167` | Inputs and stronger separation |
| text | `#eef4ee` | Primary text |
| muted text | `#aebbb2` | Secondary copy |
| subtle text | `#98a79d` | Metadata and labels |
| accent | `#7bd68f` | Brand mark, active status, badges |
| strong accent | `#3aa875` | Primary actions |
| accent contrast | `#07130d` | Text/icons on strong accent |
| focus | `#9ae7a9` | 3px focus outline |
| danger bg/border/text | `#392018` / `#c06a4c` / `#ffb69f` | Destructive and failed states |
| warning bg/border/text | `#332515` / `#b57a36` / `#f7c684` | Attention and source-selection states |

The injected browser-extension sidebar is intentionally light so it remains distinguishable over arbitrary third-party pages. Its core colors are `#f8faf6`, white surfaces, dark green `#21362e`, action green `#1e6f55`, and highlight green `#23d18b`.

## Typography

- Font stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- No external font file is currently bundled; the stack may resolve to the platform UI font.
- Desktop page title: `clamp(28px, 3vw, 42px)`, line-height `1.04`.
- Card title: 17px, 1.25 line-height, maximum two lines.
- Queue title: 16px, 1.3 line-height, maximum two lines.
- Metadata: 11–14px depending on role.
- Labels and status badges are commonly 700–800 weight.
- Avoid serif/display fonts and avoid very light weights.

## Shape, elevation, and spacing

- Standard radius: 6px for controls, 8px for cards/dialogs/navigation, 10px for completion toasts, pill radius for badges/status.
- Workspace padding: 32px desktop/tablet, 18px phone.
- Grid and repeated-card gap: 18px; queue gap: 12px.
- Standard control height: 42px; primary desktop actions: 46px; small desktop icon buttons: 34–36px.
- Panel shadow: `0 18px 46px rgba(0, 0, 0, 0.26)`.
- Card shadow: `0 14px 28px rgba(0, 0, 0, 0.18)`.
- Preserve the restrained elevation hierarchy; do not add glassmorphism or heavy glow.

## Component patterns

- Primary action: strong accent background, dark accent-contrast text, 6–8px radius, 700–800 weight.
- Secondary action: muted surface with primary text.
- Destructive action: danger background or transparent surface with danger border/text depending on emphasis.
- Video card: 16:9 poster, centered circular play badge, bottom-right duration badge, title/metadata below, overflow menu at lower right.
- Queue card: status-colored 3px inline-start border, title/status header, destination context, optional notice/progress, contextual action row.
- Navigation: selected item uses sidebar surface and primary text; queue count uses accent pill.
- Dialog: dark card surface, thin border, compact title/close header, labeled controls, inline error and a clear final action.
- Focus: visible 3px focus ring with 2px offset on buttons, links, inputs, selects, and summaries.

## Responsive behavior

- Above 1040px: desktop sidebar and topbar are visible; mobile navigation is hidden.
- At or below 1040px: sidebar/topbar are hidden; mobile header and drawer are used; full workspace width supports two or three library columns.
- At or below 680px: one library column, tighter padding, stacked queue headers/subtitle selection, and narrower toast/dialog margins.
- Minimum supported page width is 320px. Primary actions remain visible at that width; long summary text may ellipsize.
- Primary tasks must not depend on hover because phones and tablets are supported browsing surfaces.

## Motion

- Motion is intentionally minimal.
- The browser-extension source-card highlight uses only a 120ms shadow/transform transition.
- Loading uses skeleton surfaces and native indeterminate progress rather than decorative animation.
- New design drafts should preserve low-motion behavior and avoid continuous ambient animation.

## Accessibility and interaction contracts

- Icon-only actions require explicit accessible names.
- Status and loading changes use `role=status`, `role=alert`, and polite live regions where appropriate.
- Modal focus is trapped and restored through Radix primitives.
- The visible Library or Queue title remains the page `h1` on both desktop and compact layouts.
- Media thumbnails are decorative when the video title is already exposed by the play control and card heading.
- Controls should remain at least 42px in primary touch contexts.
- Do not convey queue state through color alone; retain the status label and icon.

## Implementation references

- Full tokens and styles: `.superdesign/init/theme.md`
- Shared primitives: `.superdesign/init/components.md`
- App shell: `.superdesign/init/layouts.md`
- Dependency trees: `.superdesign/init/pages.md`
- Reusable draft candidates: `.superdesign/init/extractable-components.md`

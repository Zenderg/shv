import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const sourceSidebarSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/SourceSidebar.svelte'), 'utf8');
const contentScriptSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/contentScript.ts'), 'utf8');
const diagnosticsSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/Diagnostics.svelte'), 'utf8');
const sidebarStylesSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/sidebarStyles.ts'), 'utf8');
const appSource = readFileSync(resolve(process.cwd(), 'src/web/src/App.tsx'), 'utf8');

function cssBlock(selector: string) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([\\s\\S]*?)\\n    \\}`);
  const match = sidebarStylesSource.match(pattern);
  return match?.[1] ?? '';
}

describe('source helper sidebar source', () => {
  test('exposes a single control that collapses and expands the sidebar', () => {
    expect(sourceSidebarSource).toContain('aria-label={collapseButtonLabel');
    expect(sourceSidebarSource).toContain('toggleCollapsed');
    expect(sourceSidebarSource).toContain('Expand sources');
    expect(sourceSidebarSource).toContain('Collapse sources');
  });

  test('keeps the injected host within narrow viewports', () => {
    expect(contentScriptSource).toContain('sidebarHost.style.width = sidebarHostWidth(false)');
    expect(contentScriptSource).toContain('return collapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : `min(100vw, ${SIDEBAR_WIDTH}px)`');
  });

  test('accepts page bridge messages only on the packaged app origin', () => {
    expect(contentScriptSource).toContain('APP_ORIGIN');
    expect(contentScriptSource).toContain('window.location.origin !== APP_ORIGIN');
    expect(contentScriptSource).toContain("event.data?.channel !== 'SHV_SOURCE_HELPER'");
  });

  test('labels only the chosen candidate as selected after source selection', () => {
    expect(sourceSidebarSource).toContain('selectedUrl');
    expect(sourceSidebarSource).toContain('sourceSelectionButtonLabel');
  });

  test('shows source selection failures in the sidebar', () => {
    expect(sourceSidebarSource).toContain('role="alert"');
    expect(sourceSidebarSource).toContain('selectionError');
    expect(contentScriptSource).toContain('selectionError =');
  });

  test('shows manual capture failures in the sidebar', () => {
    expect(contentScriptSource).toContain('Could not start capture');
  });

  test('highlights candidates when keyboard focus enters a source card', () => {
    expect(sourceSidebarSource).toContain('onfocusin=');
    expect(sourceSidebarSource).toContain('onfocusout=');
  });

  test('labels request type separately from response content type in diagnostics', () => {
    expect(diagnosticsSource).toContain("'content type'");
    expect(diagnosticsSource).toContain("'status/request'");
    expect(diagnosticsSource).not.toContain("'status/type'");
  });

  test('keeps diagnostics out of the normal candidate list', () => {
    const diagnosticsRenderCount = sourceSidebarSource.match(/<Diagnostics session=/g)?.length ?? 0;

    expect(diagnosticsRenderCount).toBe(1);
  });

  test('shows verified, in-progress, and unavailable candidate resolution states', () => {
    expect(sourceSidebarSource).toContain('candidate.resolution');
    expect(sourceSidebarSource).toContain('checking resolution');
    expect(sourceSidebarSource).toContain('resolution unavailable');
    expect(contentScriptSource).toContain("preload = 'metadata'");
    expect(contentScriptSource).toContain('playbackMetadata: videoElementMetadata(activeVideo)');
    expect(contentScriptSource).toContain('candidateFromVerifiedVideoUrl');
    expect(contentScriptSource).toContain("type: 'SHV_DEBUG_EVENT'");
    expect(contentScriptSource).toContain('SHV_CANDIDATE_METADATA');
  });

  test('does not show the latest unrelated source session when a tab has no session', () => {
    expect(contentScriptSource).not.toContain('?? latestSession(state.sessions)');
  });

  test('uses icons for compact sidebar buttons and distinguishes capture progress from listening', () => {
    expect(sourceSidebarSource).toContain('<ChevronLeftIcon />');
    expect(sourceSidebarSource).toContain('<ChevronRightIcon />');
    expect(sourceSidebarSource).toContain('<CloseIcon />');
    expect(sourceSidebarSource).toContain('class:capturing={$sidebarView.capturePending}');
  });

  test('keeps the candidate list as the only vertical scroll container', () => {
    const sourcesBlock = cssBlock('.sources');
    const codeBlock = cssBlock('.source code');

    expect(sidebarStylesSource).toContain('grid-template-rows: auto auto minmax(0, 1fr);');
    expect(sourcesBlock).toContain('min-height: 0;');
    expect(sourcesBlock).toContain('overflow: auto;');
    expect(codeBlock).not.toContain('overflow: auto;');
    expect(codeBlock).not.toContain('max-height:');
  });

  test('does not surface backend candidate counts in the main choose-source action', () => {
    expect(appSource).toContain('Choose source');
    expect(appSource).not.toContain('Choose source (');
  });

  test('surfaces broad extension permissions in the install dialog', () => {
    expect(appSource).toContain('<all_urls>');
    expect(appSource).toContain('webRequest');
    expect(appSource).toContain('cookies');
    expect(appSource).toContain('Use source');
  });
});

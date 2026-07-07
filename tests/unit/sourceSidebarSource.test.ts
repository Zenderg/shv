import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const sourceSidebarSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/SourceSidebar.svelte'), 'utf8');
const contentScriptSource = readFileSync(resolve(process.cwd(), 'src/extension/source-helper/contentScript.ts'), 'utf8');

describe('source helper sidebar source', () => {
  test('exposes a single control that collapses and expands the sidebar', () => {
    expect(sourceSidebarSource).toContain('aria-label={collapseButtonLabel');
    expect(sourceSidebarSource).toContain('toggleCollapsed');
    expect(sourceSidebarSource).toContain('Expand sources');
    expect(sourceSidebarSource).toContain('Collapse sources');
  });

  test('keeps the injected host within narrow viewports', () => {
    expect(contentScriptSource).toContain('sidebarHost.style.width = sidebarHostWidth(false)');
    expect(contentScriptSource).toContain('width: min(100vw, ${SIDEBAR_WIDTH}px);');
  });

  test('accepts page bridge messages only on the packaged app origin', () => {
    expect(contentScriptSource).toContain('APP_ORIGIN');
    expect(contentScriptSource).toContain('window.location.origin !== APP_ORIGIN');
    expect(contentScriptSource).toContain("event.data?.channel !== 'SHV_SOURCE_HELPER'");
  });
});

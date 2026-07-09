import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

describe('Dockerfile', () => {
  test('runs the app as a non-root user with a shared Playwright browser cache', () => {
    const runtimeUser = dockerfile.match(/^USER\s+(\S+)/m)?.[1];

    expect(runtimeUser).toBeDefined();
    expect(runtimeUser).not.toBe('root');
    expect(dockerfile).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(dockerfile).toContain('chown -R node:node /data /work /ms-playwright');
  });
});

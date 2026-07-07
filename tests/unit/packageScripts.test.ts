import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('package scripts', () => {
  it('builds the browser extension bundle as part of the production build', () => {
    expect(packageJson.scripts?.['build:extension']).toBeDefined();
    expect(packageJson.scripts?.build?.split('&&').map((part) => part.trim())).toContain('npm run build:extension');
  });
});

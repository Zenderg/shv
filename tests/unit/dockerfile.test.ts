import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
const pythonRequirements = readFileSync(resolve(process.cwd(), 'requirements-python.txt'), 'utf8');

describe('Dockerfile', () => {
  test('runs the app as a non-root user with a shared Playwright browser cache', () => {
    const runtimeUser = dockerfile.match(/^USER\s+(\S+)/m)?.[1];

    expect(runtimeUser).toBeDefined();
    expect(runtimeUser).not.toBe('root');
    expect(dockerfile).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(dockerfile).toContain('chown -R node:node /data /work /ms-playwright');
  });

  test('pins Python media downloader dependencies', () => {
    const requirementLines = pythonRequirements.split('\n').filter((line) => line.trim() && !line.startsWith('#'));

    expect(dockerfile).toContain('COPY requirements-python.txt ./');
    expect(dockerfile).toContain('python3 -m pip install --break-system-packages --no-cache-dir -r requirements-python.txt');
    expect(dockerfile).not.toContain('pip install --upgrade');
    expect(pythonRequirements).toContain('yt-dlp[default]==2026.7.4');
    expect(pythonRequirements).toContain('curl_cffi==0.15.0');
    expect(requirementLines.every((line) => line.includes('=='))).toBe(true);
  });
});

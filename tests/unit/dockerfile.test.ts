import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const dockerfilePath = resolve(process.cwd(), 'Dockerfile');
const dockerEntrypointPath = resolve(process.cwd(), 'docker-entrypoint.sh');
const dockerfile = readFileSync(dockerfilePath, 'utf8');
const dockerEntrypoint = readFileSync(dockerEntrypointPath, 'utf8');
const pythonRequirements = readFileSync(resolve(process.cwd(), 'requirements-python.txt'), 'utf8');

describe('Dockerfile', () => {
  test('migrates persistent volume ownership before running the app as a non-root user', () => {
    const runtimeUser = dockerfile.match(/^USER\s+(\S+)/m)?.[1];

    expect(runtimeUser).toBe('root');
    expect(dockerfile).toContain('gosu');
    expect(dockerfile).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(dockerfile).toContain('COPY --from=validation /app/dist ./dist');
    expect(dockerfile).toContain('COPY --from=validation /app/extension ./extension');
    expect(dockerfile).toContain('chown -R node:node /data /work /ms-playwright');
    expect(dockerfile).toContain('ENTRYPOINT ["shv-entrypoint"]');
    expect(dockerfile).toContain('HEALTHCHECK --interval=30s --timeout=3s --start-period=5m');
    expect(dockerfile).toContain('CMD ["gosu", "node", "node", "-e"');

    const migration = dockerEntrypoint.indexOf('find "$root" -xdev -uid 0 -exec chown -h');
    const privilegeDrop = dockerEntrypoint.indexOf('exec gosu "$runtime_user" tini -- "$@"');

    expect(migration).toBeGreaterThan(-1);
    expect(privilegeDrop).toBeGreaterThan(migration);
    expect(dockerEntrypoint).not.toContain('migration_marker');
    expect(dockerEntrypoint).toContain('require_runtime_file /data/app/shv.sqlite-wal');
    expect(dockerEntrypoint).toContain('require_runtime_file /data/app/shv.sqlite-shm');
    expect(dockerEntrypoint).toContain('require_runtime_file /data/app/shv.sqlite-journal');
    expect(() => execFileSync('sh', ['-n', dockerEntrypointPath])).not.toThrow();
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

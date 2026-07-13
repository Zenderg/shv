import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from '../../src/web/src/lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web API job lookup', () => {
  test('returns null when a disappeared job was deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'job_not_found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404
    })));

    await expect(api.job('deleted-job')).resolves.toBeNull();
  });

  test('preserves transient lookup failures for the completion retry flow', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Service unavailable', { status: 503 })));

    await expect(api.job('completed-job')).rejects.toThrow('Service unavailable');
  });
});

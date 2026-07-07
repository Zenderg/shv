import { afterEach, describe, expect, test, vi } from 'vitest';
import { evaluateExtensionHandshake, isVersionAtLeast, openSourceWithExtension } from '../../src/web/src/lib/extensionBridge.js';

const originalWindow = globalThis.window;

describe('extension bridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.window = originalWindow;
  });

  test('compares semantic versions by numeric segments', () => {
    expect(isVersionAtLeast('1.0.0', '1.0.0')).toBe(true);
    expect(isVersionAtLeast('1.2.0', '1.1.9')).toBe(true);
    expect(isVersionAtLeast('1.10.0', '1.2.0')).toBe(true);
    expect(isVersionAtLeast('1.0.0', '1.0.1')).toBe(false);
  });

  test('classifies missing, outdated, and ready handshakes', () => {
    expect(evaluateExtensionHandshake(null, '1.0.0', 1)).toEqual({ kind: 'missing' });
    expect(evaluateExtensionHandshake({ installed: true, version: '0.9.0', protocolVersion: 1 }, '1.0.0', 1)).toEqual({
      currentVersion: '0.9.0',
      kind: 'outdated',
      requiredVersion: '1.0.0'
    });
    expect(evaluateExtensionHandshake({ installed: true, version: '1.0.0', protocolVersion: 0 }, '1.0.0', 1)).toEqual({
      currentVersion: '1.0.0',
      kind: 'outdated',
      requiredVersion: '1.0.0'
    });
    expect(evaluateExtensionHandshake({ installed: true, version: '1.1.0', protocolVersion: 1 }, '1.0.0', 1)).toEqual({
      kind: 'ready',
      version: '1.1.0'
    });
  });

  test('does not retry open-source commands through the content-script bridge while runtime delivery is pending', async () => {
    vi.useFakeTimers();
    const runtimeCallback: { current?: (response: unknown) => void } = {};
    const postMessage = vi.fn();

    globalThis.window = {
      addEventListener: vi.fn(),
      chrome: {
        runtime: {
          sendMessage: vi.fn((_extensionId: string, _message: unknown, callback: (response: unknown) => void) => {
            runtimeCallback.current = callback;
          })
        }
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {
        randomUUID: () => 'request-id'
      },
      location: {
        origin: 'http://127.0.0.1:8080'
      },
      postMessage,
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    const openPromise = openSourceWithExtension({
      jobId: 'job-id',
      sourceUrl: 'https://www.youtube.com/live/Hogfg_GQAxk',
      titleHint: null
    });

    await vi.advanceTimersByTimeAsync(1300);

    expect(postMessage).not.toHaveBeenCalled();
    const callback = runtimeCallback.current;
    if (!callback) {
      throw new Error('Runtime callback was not registered');
    }
    callback({ ok: true });
    await openPromise;
  });
});

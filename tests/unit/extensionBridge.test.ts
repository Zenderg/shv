import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DEV_SOURCE_EXTENSION_ID,
  PROD_SOURCE_EXTENSION_ID,
  checkSourceExtension,
  evaluateExtensionHandshake,
  isVersionAtLeast,
  openSourceWithExtension,
  sourceExtensionTargetForOrigin
} from '../../src/web/src/lib/extensionBridge.js';

const originalWindow = globalThis.window;

describe('extension bridge', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  test('uses the production extension id by default, even for local origins', () => {
    expect(sourceExtensionTargetForOrigin('http://127.0.0.1:8080').id).not.toBe(DEV_SOURCE_EXTENSION_ID);
    expect(sourceExtensionTargetForOrigin('http://localhost:8080').id).not.toBe(DEV_SOURCE_EXTENSION_ID);
    expect(sourceExtensionTargetForOrigin('http://192.168.1.42:8080').id).not.toBe(DEV_SOURCE_EXTENSION_ID);
  });

  test('uses the dev extension id only when explicitly requested', () => {
    expect(sourceExtensionTargetForOrigin('https://videos.example.test', 'dev').id).toBe(DEV_SOURCE_EXTENSION_ID);
    expect(sourceExtensionTargetForOrigin('http://192.168.1.42:8080', 'dev').id).toBe(DEV_SOURCE_EXTENSION_ID);
  });

  test('sends runtime messages to the production extension id by default from localhost', async () => {
    const sendMessage = vi.fn((_extensionId: string, _message: unknown, callback: (response: unknown) => void) => {
      callback({ installed: true, protocolVersion: 1, version: '1.0.29' });
    });

    globalThis.window = {
      addEventListener: vi.fn(),
      chrome: {
        runtime: {
          sendMessage
        }
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {
        randomUUID: () => 'request-id'
      },
      location: {
        origin: 'http://127.0.0.1:8080'
      },
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    await expect(checkSourceExtension()).resolves.toEqual({ kind: 'ready', version: '1.0.29' });

    expect(sendMessage).toHaveBeenCalledWith(
      PROD_SOURCE_EXTENSION_ID,
      expect.objectContaining({ type: 'SHV_HELLO' }),
      expect.any(Function)
    );
  });

  test('sends runtime messages to the dev extension id when requested', async () => {
    const sendMessage = vi.fn((_extensionId: string, _message: unknown, callback: (response: unknown) => void) => {
      callback({ installed: true, protocolVersion: 1, version: '1.0.29' });
    });

    globalThis.window = {
      addEventListener: vi.fn(),
      chrome: {
        runtime: {
          sendMessage
        }
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {
        randomUUID: () => 'request-id'
      },
      location: {
        origin: 'http://127.0.0.1:8080'
      },
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    await expect(checkSourceExtension('dev')).resolves.toEqual({ kind: 'ready', version: '1.0.29' });

    expect(sendMessage).toHaveBeenCalledWith(
      DEV_SOURCE_EXTENSION_ID,
      expect.objectContaining({ type: 'SHV_HELLO' }),
      expect.any(Function)
    );
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

  test('retries open-source commands through the content-script bridge after immediate runtime delivery failure', async () => {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();
    const runtime = {
      lastError: undefined as { message?: string } | undefined,
      sendMessage: vi.fn((_extensionId: string, _message: unknown, callback: (response: unknown) => void) => {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        callback(undefined);
      })
    };

    globalThis.window = {
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        messageHandler = listener as (event: MessageEvent) => void;
      }),
      chrome: {
        runtime
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {
        randomUUID: () => 'request-id'
      },
      location: {
        origin: 'https://videos.example.test'
      },
      postMessage,
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    const openPromise = openSourceWithExtension({
      jobId: 'job-id',
      sourceUrl: 'https://source.example.test/watch',
      titleHint: null
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    const payload = postMessage.mock.calls[0]?.[0] as { requestId?: string };
    expect(payload).toMatchObject({
      channel: 'SHV_SOURCE_HELPER',
      message: expect.objectContaining({ type: 'SHV_OPEN_SOURCE' })
    });

    messageHandler?.({
      data: {
        channel: 'SHV_SOURCE_HELPER_RESPONSE',
        extensionId: 'ncgeehcdlbbdgojleaoefhhdinmdhcaf',
        requestId: payload.requestId,
        response: { ok: true }
      },
      source: window
    } as unknown as MessageEvent);

    await openPromise;
  });

  test('reports an outdated extension through the content-script bridge after immediate runtime delivery failure', async () => {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const runtime = {
      lastError: undefined as { message?: string } | undefined,
      sendMessage: vi.fn((_extensionId: string, _message: unknown, callback: (response: unknown) => void) => {
        runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
        callback(undefined);
      })
    };

    globalThis.window = {
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        messageHandler = listener as (event: MessageEvent) => void;
      }),
      chrome: {
        runtime
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {
        randomUUID: () => 'request-id'
      },
      location: {
        origin: 'https://videos.example.test'
      },
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    const statusPromise = checkSourceExtension();
    await vi.waitFor(() => expect(window.postMessage).toHaveBeenCalledOnce());
    const payload = vi.mocked(window.postMessage).mock.calls[0]?.[0] as { requestId?: string };

    messageHandler?.({
      data: {
        channel: 'SHV_SOURCE_HELPER_RESPONSE',
        extensionId: 'ncgeehcdlbbdgojleaoefhhdinmdhcaf',
        requestId: payload.requestId,
        response: { installed: true, protocolVersion: 1, version: '1.0.22' }
      },
      source: window
    } as unknown as MessageEvent);

    await expect(statusPromise).resolves.toEqual({
      currentVersion: '1.0.22',
      kind: 'outdated',
      requiredVersion: '1.0.29'
    });
  });

  test('uses a fallback bridge request id when crypto.randomUUID is unavailable', async () => {
    let messageHandler: ((event: MessageEvent) => void) | undefined;
    const postMessage = vi.fn();

    vi.stubGlobal('crypto', {});
    globalThis.window = {
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        messageHandler = listener as (event: MessageEvent) => void;
      }),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      crypto: {},
      location: {
        origin: 'http://192.168.1.42:8080'
      },
      postMessage,
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis)
    } as unknown as Window & typeof globalThis;

    const statusPromise = checkSourceExtension();

    expect(postMessage).toHaveBeenCalledOnce();
    const payload = postMessage.mock.calls[0]?.[0] as { extensionId?: string; requestId?: string };
    expect(payload.extensionId).not.toBe(DEV_SOURCE_EXTENSION_ID);
    expect(payload.requestId).toEqual(expect.any(String));
    expect(payload.requestId).not.toHaveLength(0);
    expect(messageHandler).toBeDefined();

    messageHandler?.({
      data: {
        channel: 'SHV_SOURCE_HELPER_RESPONSE',
        extensionId: payload.extensionId,
        requestId: payload.requestId,
        response: { installed: true, protocolVersion: 1, version: '1.0.29' }
      },
      source: window
    } as unknown as MessageEvent);

    await expect(statusPromise).resolves.toEqual({ kind: 'ready', version: '1.0.29' });
  });
});

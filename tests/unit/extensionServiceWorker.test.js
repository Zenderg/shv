import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;
const originalFetch = globalThis.fetch;

function chromeEvent(listeners, name) {
  return {
    addListener: vi.fn((callback) => {
      listeners[name] = callback;
    })
  };
}

describe('extension service worker', () => {
  let listeners;
  let storage;

  beforeEach(() => {
    vi.resetModules();
    listeners = {};
    storage = {
      sourceState: {
        activeTabId: 42,
        sessions: {
          42: {
            activeCaptureUntil: Date.now() + 30_000,
            appTabId: 7,
            candidates: [],
            currentUrl: 'https://www.youtube.com/watch?v=test',
            diagnostics: { network: { classified: 0, mapped: 0, observed: 0, unmapped: 0 }, playback: null },
            jobId: 'job-id',
            sourceUrl: 'https://www.youtube.com/watch?v=test',
            status: 'listening',
            updatedAt: new Date().toISOString()
          }
        }
      }
    };

    globalThis.chrome = {
      action: { onClicked: chromeEvent(listeners, 'actionClicked') },
      cookies: {
        getAll: vi.fn(async ({ url }) => {
          if (url === 'https://www.youtube.com/watch?v=test') {
            return [
              {
                domain: '.youtube.com',
                expirationDate: 1893456000,
                httpOnly: true,
                name: 'SID',
                path: '/',
                secure: true,
                value: 'youtube-session'
              }
            ];
          }
          if (url === 'https://media.example.test/video.mp4') {
            return [
              {
                domain: 'media.example.test',
                expirationDate: 1893456000,
                httpOnly: false,
                name: 'media_session',
                path: '/',
                secure: true,
                value: 'media-value'
              }
            ];
          }
          return [];
        })
      },
      runtime: {
        onMessage: chromeEvent(listeners, 'runtimeMessage'),
        onMessageExternal: chromeEvent(listeners, 'runtimeMessageExternal'),
        sendMessage: vi.fn(() => Promise.resolve())
      },
      storage: {
        local: {
          get: vi.fn(async () => storage),
          set: vi.fn(async (next) => {
            storage = { ...storage, ...next };
          })
        }
      },
      tabs: {
        onRemoved: chromeEvent(listeners, 'tabRemoved'),
        query: vi.fn(async () => []),
        sendMessage: vi.fn(() => Promise.resolve()),
        update: vi.fn(async () => ({ windowId: 1 }))
      },
      webRequest: {
        onBeforeSendHeaders: chromeEvent(listeners, 'beforeSendHeaders'),
        onCompleted: chromeEvent(listeners, 'completed'),
        onErrorOccurred: chromeEvent(listeners, 'errorOccurred'),
        onHeadersReceived: chromeEvent(listeners, 'headersReceived')
      },
      windows: {
        update: vi.fn(async () => ({}))
      }
    };
    globalThis.fetch = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return {
        json: async () => body.candidates.map((candidate, index) => ({ ...candidate, id: `candidate-${index}` })),
        ok: true,
        status: 200
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  });

  test('keeps captured request headers when recording a network candidate asynchronously', async () => {
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.beforeSendHeaders({
      requestHeaders: [
        { name: 'User-Agent', value: 'Mozilla/5.0 test' },
        { name: 'Referer', value: 'https://www.youtube.com/watch?v=test' }
      ],
      requestId: 'request-1'
    });
    listeners.headersReceived({
      initiator: 'https://www.youtube.com',
      requestId: 'request-1',
      responseHeaders: [{ name: 'content-type', value: 'text/plain' }],
      statusCode: 200,
      tabId: 42,
      type: 'xmlhttprequest',
      url: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=18&source=youtube&mime=video%2Fmp4&ratebypass=yes'
    });

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);

    expect(body.candidates[0].headers).toMatchObject({
      Referer: 'https://www.youtube.com/watch?v=test',
      'User-Agent': 'Mozilla/5.0 test'
    });
    expect(storage.sourceState.sessions[42].diagnostics.network.lastHeaderKeys).toBe('Referer, User-Agent');
  });

  test('serializes concurrent state updates so burst network candidates are not lost', async () => {
    globalThis.chrome.storage.local.get = vi.fn(async () => structuredClone(storage));
    globalThis.chrome.storage.local.set = vi.fn(async (next) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      storage = { ...storage, ...structuredClone(next) };
    });
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.headersReceived({
      initiator: 'https://www.youtube.com',
      requestId: 'request-a',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
      statusCode: 200,
      tabId: 42,
      type: 'media',
      url: 'https://media.example.test/video-a.mp4'
    });
    listeners.headersReceived({
      initiator: 'https://www.youtube.com',
      requestId: 'request-b',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
      statusCode: 200,
      tabId: 42,
      type: 'media',
      url: 'https://media.example.test/video-b.mp4'
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates.map((candidate) => candidate.url).sort()).toEqual([
        'https://media.example.test/video-a.mp4',
        'https://media.example.test/video-b.mp4'
      ])
    );
  });

  test('sends relevant browser cookies when a source is selected', async () => {
    storage.sourceState.sessions[42].candidates = [
      {
        bitrate: null,
        confidence: 0.86,
        contentType: 'video/mp4',
        durationSeconds: null,
        headers: {},
        kind: 'browser-request',
        manifestType: null,
        resolution: null,
        sizeBytes: null,
        url: 'https://media.example.test/video.mp4'
      }
    ];
    globalThis.fetch = vi.fn(async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : {};
      if (String(url).endsWith('/extension-candidates')) {
        return {
          json: async () => body.candidates.map((candidate, index) => ({ ...candidate, id: `candidate-${index}` })),
          ok: true,
          status: 200
        };
      }
      return {
        json: async () => ({ ok: true }),
        ok: true,
        status: 200
      };
    });
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      { tabId: 42, type: 'SHV_SELECT_SOURCE', url: 'https://media.example.test/video.mp4' },
      { tab: { id: 42 } },
      sendResponse
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    const candidateCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/extension-candidates'));
    const cookieCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/cookies'));
    expect(JSON.parse(candidateCall[1].body).candidates[0].headers.Cookie).toBe('media_session=media-value');
    expect(JSON.parse(cookieCall[1].body).cookies.map((cookie) => cookie.name).sort()).toEqual(['SID', 'media_session']);
  });
});

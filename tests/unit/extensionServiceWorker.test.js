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
      scripting: {
        executeScript: vi.fn(async () => [])
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
        create: vi.fn(async ({ url }) => ({ id: 99, url, windowId: 1 })),
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

  test('reports missing when the app origin does not match the packaged helper origin', async () => {
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessageExternal(
      { protocolVersion: 1, type: 'SHV_HELLO' },
      { url: 'http://localhost:8080/' },
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ installed: false }));
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
    expect(storage.sourceState.sessions[42].selectedUrl).toBe('https://media.example.test/video.mp4');
    const candidateCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/extension-candidates'));
    const cookieCall = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/cookies'));
    expect(JSON.parse(candidateCall[1].body).candidates[0].headers.Cookie).toBe('media_session=media-value');
    expect(JSON.parse(cookieCall[1].body).cookies.map((cookie) => cookie.name).sort()).toEqual(['SID', 'media_session']);
  });

  test('does not let a source tab select a different tab session by spoofing tabId', async () => {
    storage.sourceState.sessions[43] = {
      ...storage.sourceState.sessions[42],
      candidates: [
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
      ],
      jobId: 'other-job-id',
      sourceUrl: 'https://other.example.test/watch'
    };
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
      { tabId: 43, type: 'SHV_SELECT_SOURCE', url: 'https://media.example.test/video.mp4' },
      { tab: { id: 42 }, url: 'https://www.youtube.com/watch?v=test' },
      sendResponse
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('updates the session current URL from playback diagnostics after page navigation', async () => {
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        diagnostic: {
          activeFound: true,
          dominantFound: true,
          frameUrl: 'https://www.youtube.com/watch?v=next',
          isTopFrame: true,
          largeVisibleCount: 1,
          sentAt: new Date().toISOString(),
          videoCount: 1
        },
        type: 'SHV_PLAYBACK_DIAGNOSTIC'
      },
      { tab: { id: 42 }, url: 'https://www.youtube.com/watch?v=next' },
      sendResponse
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    expect(storage.sourceState.sessions[42].currentUrl).toBe('https://www.youtube.com/watch?v=next');
  });

  test('reports unmapped media-like requests on the active source session while capture is active', async () => {
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.headersReceived({
      initiator: 'https://unrelated.example.test',
      requestId: 'unmapped-request',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
      statusCode: 200,
      tabId: -1,
      type: 'media',
      url: 'https://cdn.unrelated.example.test/video.mp4'
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storage.sourceState.sessions[42].diagnostics.network.observed).toBe(1);
    expect(storage.sourceState.sessions[42].diagnostics.network.unmapped).toBe(1);
    expect(storage.sourceState.sessions[42].diagnostics.network.lastReason).toBe('media-like request was not mapped to a source tab');
  });

  test('injects the content script before showing a newly opened source tab', async () => {
    globalThis.chrome.tabs.sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessageExternal(
      {
        jobId: 'job-id',
        protocolVersion: 1,
        sourceUrl: 'https://source.example.test/watch',
        type: 'SHV_OPEN_SOURCE'
      },
      { url: 'http://127.0.0.1:8080/' },
      sendResponse
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, tabId: 99 }));
    expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalledWith({
      files: ['content-script.js'],
      target: { allFrames: true, tabId: 99 }
    });
  });
});

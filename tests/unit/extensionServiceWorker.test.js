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
          if (url === 'https://cdn.example.test/alternate.mp4') {
            return [
              {
                domain: 'cdn.example.test',
                expirationDate: 1893456000,
                httpOnly: false,
                name: 'cdn_session',
                path: '/',
                secure: true,
                value: 'cdn-value'
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
      webNavigation: {
        onCommitted: chromeEvent(listeners, 'navigationCommitted')
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

  test('accepts verified candidate metadata from the source tab', async () => {
    storage.sourceState.sessions[42].candidates = [
      {
        bitrate: null,
        confidence: 0.86,
        contentType: 'video/mp4',
        durationSeconds: null,
        headers: { Referer: 'https://www.youtube.com/watch?v=test' },
        kind: 'browser-request',
        manifestType: null,
        resolution: null,
        sizeBytes: null,
        url: 'https://media.example.test/video.mp4'
      }
    ];
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        candidates: [
          {
            bitrate: null,
            confidence: 0.86,
            contentType: 'video/mp4',
            durationSeconds: 18.2,
            headers: {},
            kind: 'browser-request',
            manifestType: null,
            resolution: '1280x720',
            sizeBytes: null,
            url: 'https://media.example.test/video.mp4'
          }
        ],
        type: 'SHV_CANDIDATE_METADATA'
      },
      { tab: { id: 42 } },
      sendResponse
    );

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));

    expect(storage.sourceState.sessions[42].candidates[0]).toMatchObject({
      durationSeconds: 18.2,
      headers: { Referer: 'https://www.youtube.com/watch?v=test' },
      resolution: '1280x720'
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/api/jobs/job-id/extension-candidates',
      expect.objectContaining({
        body: expect.stringContaining('"resolution":"1280x720"')
      })
    );
  });

  test('posts extension debug events from content scripts to the app backend', async () => {
    const sendResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        event: {
          candidateUrl: 'https://vkv531.okcdn.ru/?sig=test',
          eventType: 'metadata-probe',
          frameUrl: 'https://vk.example.test/embed',
          reason: 'video-error',
          status: 'unavailable'
        },
        type: 'SHV_DEBUG_EVENT'
      },
      { tab: { id: 42 } },
      sendResponse
    );

    await vi.waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/api/debug/extension/events',
        expect.objectContaining({
          body: expect.stringContaining('"eventType":"metadata-probe"'),
          method: 'POST'
        })
      )
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  test('applies active playback metadata to browser request candidates captured in the same tab', async () => {
    const activeResponse = vi.fn();
    const mediaUrl = 'https://vkv531.okcdn.ru/?expires=1783762251943&type=3&sig=test';
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        candidates: [],
        currentSrc: mediaUrl,
        playbackMetadata: {
          durationSeconds: 73.25,
          resolution: '1920x1080'
        },
        type: 'SHV_ACTIVE_PLAYBACK'
      },
      { tab: { id: 42 } },
      activeResponse
    );

    await vi.waitFor(() => expect(activeResponse).toHaveBeenCalledWith({ captured: 0, ok: true }));

    listeners.headersReceived({
      initiator: 'https://vkvideo.example.test',
      requestId: 'request-okcdn',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
      statusCode: 206,
      tabId: 42,
      type: 'media',
      url: mediaUrl
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates[0]).toMatchObject({
        durationSeconds: 73.25,
        resolution: '1920x1080',
        url: mediaUrl
      })
    );
    const candidatePost = globalThis.fetch.mock.calls.find(([url]) => String(url).endsWith('/extension-candidates'));
    expect(JSON.parse(candidatePost[1].body).candidates[0]).toMatchObject({
      durationSeconds: 73.25,
      resolution: '1920x1080'
    });
  });

  test('updates pending network candidates only from matching active playback currentSrc metadata', async () => {
    const highUrl = 'https://vkvd531.okcdn.ru/?expires=1783762251943&type=3&sig=high';
    const lowUrl = 'https://vkvd531.okcdn.ru/?expires=1783762251943&type=0&sig=low';
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        candidates: [],
        currentSrc: highUrl,
        playbackMetadata: {
          durationSeconds: 1159.83,
          resolution: '1280x720'
        },
        type: 'SHV_ACTIVE_PLAYBACK'
      },
      { tab: { id: 42 } },
      vi.fn()
    );

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].activePlaybackMetadata).toMatchObject({
        currentSrc: highUrl,
        resolution: '1280x720'
      })
    );

    listeners.headersReceived({
      initiator: 'https://nmcorp.video',
      requestId: 'request-low',
      responseHeaders: [{ name: 'content-type', value: 'video/mp4' }],
      statusCode: 200,
      tabId: 42,
      type: 'media',
      url: lowUrl
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates.find((candidate) => candidate.url === lowUrl)).toMatchObject({
        resolution: null
      })
    );

    listeners.runtimeMessage(
      {
        candidates: [],
        currentSrc: lowUrl,
        playbackMetadata: {
          durationSeconds: 1159.83,
          resolution: '426x240'
        },
        type: 'SHV_ACTIVE_PLAYBACK'
      },
      { tab: { id: 42 } },
      vi.fn()
    );

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates.find((candidate) => candidate.url === lowUrl)).toMatchObject({
        durationSeconds: 1159.83,
        resolution: '426x240',
        url: lowUrl
      })
    );
  });

  test('fills HLS media playlist resolution from the matching master playlist variant', async () => {
    const masterUrl = 'https://iv-h.phncdn.com/videos/202411/19/460719291/1080P_4000K_460719291.mp4/master.m3u8';
    const mediaUrl = 'https://iv-h.phncdn.com/videos/202411/19/460719291/1080P_4000K_460719291.mp4/index-v1-a1.m3u8';
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/extension-candidates')) {
        const body = JSON.parse(options.body);
        return {
          json: async () => body.candidates.map((candidate, index) => ({ ...candidate, id: `candidate-${index}` })),
          ok: true,
          status: 200
        };
      }
      if (String(url).endsWith('/debug/extension/events')) {
        return { ok: true, status: 200 };
      }
      if (String(url) === masterUrl) {
        return {
          ok: true,
          status: 200,
          text: async () => `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1920
index-v1-a1.m3u8`
        };
      }
      throw new Error(`Unexpected fetch ${String(url)}`);
    });
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.headersReceived({
      initiator: 'https://rt.pornhub.com',
      requestId: 'hls-media',
      responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }],
      statusCode: 200,
      tabId: 42,
      type: 'xmlhttprequest',
      url: mediaUrl
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates.find((candidate) => candidate.url === mediaUrl)).toMatchObject({
        resolution: null
      })
    );

    listeners.headersReceived({
      initiator: 'https://rt.pornhub.com',
      requestId: 'hls-master',
      responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }],
      statusCode: 200,
      tabId: 42,
      type: 'xmlhttprequest',
      url: masterUrl
    });

    await vi.waitFor(() => {
      const candidates = storage.sourceState.sessions[42].candidates;
      expect(candidates.find((candidate) => candidate.url === masterUrl)).toMatchObject({ resolution: '1080x1920' });
      expect(candidates.find((candidate) => candidate.url === mediaUrl)).toMatchObject({ resolution: '1080x1920' });
    });
  });

  test('captures multiple subtitle network tracks without selecting one in the extension', async () => {
    storage.sourceState.sessions[42].candidates = [
      {
        bitrate: null,
        confidence: 0.92,
        contentType: 'application/vnd.apple.mpegurl',
        durationSeconds: null,
        headers: {},
        kind: 'hls',
        manifestType: 'hls',
        resolution: '1280x720',
        sizeBytes: null,
        subtitleTracks: [],
        url: 'https://media.example.test/video/index-v1-a1.m3u8'
      }
    ];
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.headersReceived({
      initiator: 'https://media.example.test',
      requestId: 'sub-ru',
      responseHeaders: [{ name: 'content-type', value: 'application/octet-stream' }],
      statusCode: 200,
      tabId: 42,
      type: 'xmlhttprequest',
      url: 'https://media.example.test/video/01_raw_rus.ass'
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates[0].subtitleTracks).toEqual([
        expect.objectContaining({ isSelected: null, label: 'Russian', url: 'https://media.example.test/video/01_raw_rus.ass' })
      ])
    );

    listeners.headersReceived({
      initiator: 'https://media.example.test',
      requestId: 'sub-en',
      responseHeaders: [{ name: 'content-type', value: 'application/octet-stream' }],
      statusCode: 200,
      tabId: 42,
      type: 'xmlhttprequest',
      url: 'https://media.example.test/video/01_raw_eng.ass'
    });

    await vi.waitFor(() =>
      expect(storage.sourceState.sessions[42].candidates[0].subtitleTracks).toEqual([
        expect.objectContaining({ isSelected: null, label: 'Russian', url: 'https://media.example.test/video/01_raw_rus.ass' }),
        expect.objectContaining({ isSelected: null, label: 'English', url: 'https://media.example.test/video/01_raw_eng.ass' })
      ])
    );
  });

  test('sends source and candidate browser cookies when a source is selected', async () => {
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
      },
      {
        bitrate: null,
        confidence: 0.7,
        contentType: 'video/mp4',
        durationSeconds: null,
        headers: {},
        kind: 'browser-request',
        manifestType: null,
        resolution: null,
        sizeBytes: null,
        url: 'https://cdn.example.test/alternate.mp4'
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
    expect(JSON.parse(candidateCall[1].body).candidates[1].headers.Cookie).toBe('cdn_session=cdn-value');
    expect(JSON.parse(cookieCall[1].body).cookies.map((cookie) => cookie.name).sort()).toEqual([
      'SID',
      'cdn_session',
      'media_session'
    ]);
  });

  test('rejects selecting a stale source after active playback pauses', async () => {
    storage.sourceState.sessions[42] = {
      ...storage.sourceState.sessions[42],
      activeCaptureUntil: Date.now() + 30_000,
      activePlaybackUntil: Date.now() + 5_000,
      activePlaybackMetadata: {
        currentSrc: 'https://media.example.test/video.mp4',
        durationSeconds: 120,
        resolution: '1920x1080'
      },
      candidates: [
        {
          bitrate: null,
          confidence: 0.86,
          contentType: 'video/mp4',
          durationSeconds: null,
          headers: {},
          kind: 'html-video',
          manifestType: null,
          resolution: '1920x1080',
          sizeBytes: null,
          url: 'https://media.example.test/video.mp4'
        }
      ],
      playbackState: 'active',
      status: 'listening'
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 }));
    const inactiveResponse = vi.fn();
    const selectResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage(
      {
        currentSrc: 'https://media.example.test/video.mp4',
        type: 'SHV_PLAYBACK_INACTIVE'
      },
      { tab: { id: 42 } },
      inactiveResponse
    );

    await vi.waitFor(() => expect(inactiveResponse).toHaveBeenCalledWith({ ok: true }));
    expect(storage.sourceState.sessions[42]).toMatchObject({
      activeCaptureUntil: null,
      activePlaybackUntil: null,
      playbackState: 'inactive',
      status: 'waiting for playback'
    });

    listeners.runtimeMessage(
      { tabId: 42, type: 'SHV_SELECT_SOURCE', url: 'https://media.example.test/video.mp4' },
      { tab: { id: 42 } },
      selectResponse
    );

    await vi.waitFor(() => expect(selectResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
    expect(selectResponse.mock.calls[0][0].error).toMatch(/resume playback/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('keeps manual capture selectable when playback visibility becomes unknown', async () => {
    storage.sourceState.sessions[42] = {
      ...storage.sourceState.sessions[42],
      activeCaptureUntil: null,
      activePlaybackUntil: Date.now() - 1_000,
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
      playbackState: 'active',
      status: 'waiting for playback'
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
    const captureResponse = vi.fn();
    const selectResponse = vi.fn();
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.runtimeMessage({ tabId: 42, type: 'SHV_START_CAPTURE' }, { tab: { id: 42 } }, captureResponse);

    await vi.waitFor(() => expect(captureResponse).toHaveBeenCalledWith({ captured: 0, ok: true }));
    expect(storage.sourceState.sessions[42]).toMatchObject({
      activePlaybackUntil: null,
      playbackState: null,
      status: 'listening'
    });

    listeners.runtimeMessage(
      { tabId: 42, type: 'SHV_SELECT_SOURCE', url: 'https://media.example.test/video.mp4' },
      { tab: { id: 42 } },
      selectResponse
    );

    await vi.waitFor(() => expect(selectResponse).toHaveBeenCalledWith({ ok: true }));
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

  test('injects the content script into newly committed child frames for active source tabs', async () => {
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.navigationCommitted({
      frameId: 12,
      tabId: 42,
      url: 'https://nmcorp.video/embed/player'
    });

    await vi.waitFor(() =>
      expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalledWith({
        files: ['content-script.js'],
        target: { frameIds: [12], tabId: 42 }
      })
    );
  });

  test('restores the visible sidebar after a source tab top-frame navigation', async () => {
    await import('../../extension/chrome-source-helper/service-worker.js');

    listeners.navigationCommitted({
      frameId: 0,
      tabId: 42,
      url: 'https://www.youtube.com/watch?v=next'
    });

    await vi.waitFor(() =>
      expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalledWith({
        files: ['content-script.js'],
        target: { allFrames: true, tabId: 42 }
      })
    );
    await vi.waitFor(() =>
      expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
        tabId: 42,
        type: 'SHV_SHOW_SIDEBAR'
      })
    );
    expect(storage.sourceState.sessions[42].currentUrl).toBe('https://www.youtube.com/watch?v=next');
  });
});

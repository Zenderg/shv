<script lang="ts">
  import { mount } from 'svelte';
  import { onMount } from 'svelte';
  import SourceSidebar from '../extension/source-helper/SourceSidebar.svelte';
  import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, sidebarCss } from '../extension/source-helper/sidebarStyles';
  import {
    setSidebarActions,
    sidebarView,
    type Candidate,
    type SidebarView,
    type SourceSession
  } from '../extension/source-helper/sidebarStore';

  type ScenarioId = 'no-job' | 'empty' | 'listening' | 'candidates' | 'long-url' | 'selected' | 'capture-pending';

  const scenarios: { id: ScenarioId; label: string }[] = [
    { id: 'candidates', label: 'Candidates' },
    { id: 'empty', label: 'Empty' },
    { id: 'listening', label: 'Listening' },
    { id: 'capture-pending', label: 'Capturing' },
    { id: 'selected', label: 'Selected' },
    { id: 'long-url', label: 'Long URL' },
    { id: 'no-job', label: 'No job' }
  ];

  let sidebarHost: HTMLDivElement;
  let sidebarVisible = true;
  let activeScenario: ScenarioId = 'candidates';
  let currentView: SidebarView = {
    capturePending: false,
    collapsed: false,
    highlightedUrl: null,
    selectingUrls: [],
    session: null,
    status: 'Open a source from shv'
  };
  let highlightedUrl: string | null = null;

  $: sidebarHostWidth = currentView.collapsed ? `${SIDEBAR_COLLAPSED_WIDTH}px` : `min(100vw, ${SIDEBAR_WIDTH}px)`;
  $: highlightedCandidate = currentView.session?.candidates.find((candidate) => candidate.url === highlightedUrl) ?? null;
  $: pageHighlightVisible = Boolean(highlightedCandidate && currentView.session?.status !== 'selected');

  onMount(() => {
    const shadowRoot = sidebarHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = sidebarCss();
    shadowRoot.append(style);
    mount(SourceSidebar, { target: shadowRoot });

    setSidebarActions({
      clearHighlight: () => updateView({ highlightedUrl: null }),
      close: () => {
        sidebarVisible = false;
      },
      highlight: (url) => updateView({ highlightedUrl: url }),
      selectSource: selectSource,
      startCapture: startCapture,
      toggleCollapsed: () => updateView({ collapsed: !currentView.collapsed })
    });

    commitView(scenarioView(activeScenario));
    const refreshTimer = window.setInterval(() => sidebarView.update((view) => ({ ...view })), 1000);
    return () => window.clearInterval(refreshTimer);
  });

  function setScenario(id: ScenarioId) {
    activeScenario = id;
    sidebarVisible = true;
    commitView(scenarioView(id, { collapsed: currentView.collapsed }));
  }

  function updateView(patch: Partial<SidebarView>) {
    commitView({ ...currentView, ...patch });
  }

  function commitView(nextView: SidebarView) {
    currentView = nextView;
    highlightedUrl = nextView.highlightedUrl;
    sidebarView.set(nextView);
  }

  function showSidebar() {
    sidebarVisible = true;
  }

  function startCapture() {
    if (!currentView.session) {
      return;
    }
    const listeningSession = {
      ...currentView.session,
      activeCaptureUntil: Date.now() + 30000,
      status: 'listening',
      updatedAt: new Date().toISOString()
    };
    commitView({
      ...currentView,
      capturePending: true,
      session: listeningSession,
      status: `${listeningSession.candidates.length} active / listening 30s`
    });
    window.setTimeout(() => {
      commitView({
        ...currentView,
        capturePending: false,
        session: listeningSession,
        status: `${listeningSession.candidates.length} active / listening`
      });
    }, 700);
  }

  function selectSource(url: string) {
    if (!currentView.session) {
      return;
    }
    commitView({ ...currentView, selectingUrls: [url] });
    window.setTimeout(() => {
      if (!currentView.session) {
        return;
      }
      const selectedSession = {
        ...currentView.session,
        status: 'selected',
        updatedAt: new Date().toISOString()
      };
      commitView({
        ...currentView,
        highlightedUrl: null,
        selectingUrls: [],
        session: selectedSession,
        status: `${selectedSession.candidates.length} active / selected`
      });
    }, 550);
  }

  function scenarioView(id: ScenarioId, overrides: Partial<SidebarView> = {}): SidebarView {
    const collapsed = overrides.collapsed ?? false;
    if (id === 'no-job') {
      return {
        capturePending: false,
        collapsed,
        highlightedUrl: null,
        selectingUrls: [],
        session: null,
        status: 'Open a source from shv',
        ...overrides
      };
    }

    const session = scenarioSession(id);
    return {
      capturePending: id === 'capture-pending',
      collapsed,
      highlightedUrl: null,
      selectingUrls: id === 'capture-pending' ? [directVideoCandidate.url] : [],
      session,
      status: `${session.candidates.length} active / ${sessionStatusLabel(session)}`,
      ...overrides
    };
  }

  function scenarioSession(id: Exclude<ScenarioId, 'no-job'>): SourceSession {
    const base = {
      activeCaptureUntil: null,
      candidates: [hlsCandidate, directVideoCandidate, dashCandidate],
      currentUrl: 'https://video.example.test/watch/late-night-archive',
      diagnostics: diagnostics(),
      jobId: 'preview-job',
      sourceUrl: 'https://video.example.test/watch/late-night-archive?collection=field-recordings',
      status: 'waiting for playback',
      titleHint: 'Late Night Archive',
      updatedAt: new Date().toISOString()
    };

    if (id === 'empty') {
      return { ...base, candidates: [] };
    }
    if (id === 'listening' || id === 'capture-pending') {
      return { ...base, activeCaptureUntil: Date.now() + 30000, candidates: [], status: 'listening' };
    }
    if (id === 'selected') {
      return { ...base, status: 'selected' };
    }
    if (id === 'long-url') {
      return {
        ...base,
        candidates: [longUrlCandidate],
        sourceUrl:
          'https://very-long-source.example.test/watch/releases/season/finale/with/many/path/parts?token=visual-preview-only&quality=adaptive&source=embedded-player'
      };
    }
    return base;
  }

  function sessionStatusLabel(session: SourceSession) {
    if (session.status === 'selected') {
      return 'selected';
    }
    return session.activeCaptureUntil ? 'listening' : 'waiting for playback';
  }

  function candidate(kind: string, url: string, contentType: string | null, manifestType: string | null, confidence: number): Candidate {
    return {
      bitrate: null,
      confidence,
      contentType,
      durationSeconds: null,
      headers: {},
      kind,
      manifestType,
      resolution: null,
      sizeBytes: null,
      url
    };
  }

  function diagnostics() {
    return {
      network: {
        classified: 8,
        lastHeaderKeys: 'accept, referer, user-agent',
        lastHost: 'cdn.video.example.test',
        lastPath: '/media/index-v1-a1.m3u8',
        lastQueryKeys: 'token, expires, sig',
        lastReason: 'accepted as HLS',
        lastRejectReason: 'no video content-type, extension, or mime query hint',
        lastStatusCode: 200,
        lastType: 'application/vnd.apple.mpegurl',
        mapped: 3,
        observed: 19,
        unmapped: 4
      },
      playback: {
        activeFound: true,
        dominantFound: true,
        largeVisibleCount: 1,
        videoCount: 2,
        videos: [
          {
            currentSrcKind: 'https://cdn.video.example.test',
            currentTime: 418,
            ended: false,
            height: 420,
            paused: false,
            readyState: 4,
            srcKind: 'empty',
            width: 746
          }
        ]
      }
    };
  }

  const hlsCandidate = candidate(
    'hls',
    'https://cdn.video.example.test/media/index-v1-a1.m3u8?token=preview&expires=1890000000&sig=abc123',
    'application/vnd.apple.mpegurl',
    'hls',
    0.92
  );
  const directVideoCandidate = candidate(
    'html-video',
    'https://cdn.video.example.test/files/late-night-archive-1080p.mp4',
    'video/mp4',
    null,
    0.86
  );
  const dashCandidate = candidate(
    'dash',
    'https://stream.video.example.test/dash/manifest.mpd?profile=main',
    'application/dash+xml',
    'dash',
    0.9
  );
  const longUrlCandidate = candidate(
    'browser-request',
    'https://media-cdn-with-a-very-long-hostname.example.test/video/playback/session/6fe75d9d-26bc-4b31-88ec-visual-preview-only/segment/index-v1-a1.m3u8?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiKiJ9XX0&Signature=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&Key-Pair-Id=KPREVIEW1234567890',
    'application/vnd.apple.mpegurl',
    'hls',
    0.78
  );
</script>

<main>
  <section class="previewControls" aria-label="Preview controls">
    <div class="previewIntro">
      <h1>Source Helper Preview</h1>
      <p>Visual harness. No Docker, browser extension, cookies, or source capture runtime.</p>
    </div>
    <div class="scenarioButtons" aria-label="Sidebar states">
      {#each scenarios as scenario}
        <button class:active={activeScenario === scenario.id} type="button" onclick={() => setScenario(scenario.id)}>
          {scenario.label}
        </button>
      {/each}
    </div>
    <div class="toolbar">
      <button type="button" onclick={() => updateView({ collapsed: !currentView.collapsed })}>
        {currentView.collapsed ? 'Expand' : 'Collapse'}
      </button>
      <button type="button" onclick={showSidebar}>Show</button>
    </div>
  </section>

  <section class="mockPage" aria-label="Mock source page">
    <div class="mockHeader">
      <strong>video.example.test</strong>
      <span>Mock source page</span>
    </div>
    <div class="mockVideo">
      <div class:visible={pageHighlightVisible} class="mediaHighlight">
        <span>{highlightedCandidate?.kind ?? 'source'} source</span>
      </div>
      <div class="playButton">Play</div>
    </div>
    <div class="mockMeta">
      <h2>Late Night Archive</h2>
      <p>Static preview content behind the injected sidebar.</p>
    </div>
  </section>
</main>

<div bind:this={sidebarHost} class="sidebarHost" style:display={sidebarVisible ? 'block' : 'none'} style:width={sidebarHostWidth}></div>

<script lang="ts">
  import Diagnostics from './Diagnostics.svelte';
  import { visibleSidebarCandidates } from './candidateDisplay';
  import ChevronLeftIcon from './ChevronLeftIcon.svelte';
  import ChevronRightIcon from './ChevronRightIcon.svelte';
  import CloseIcon from './CloseIcon.svelte';
  import { sidebarActions, sidebarView, type Candidate, type SourceSession } from './sidebarStore';
  import { sourceSelectionButtonLabel, sourceSelectionDisabledReason } from './sourceSelection';

  function hostname(url: string) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function captureSecondsRemaining(session: SourceSession) {
    if (typeof session.activeCaptureUntil !== 'number') {
      return 0;
    }
    return Math.max(0, Math.ceil((session.activeCaptureUntil - Date.now()) / 1000));
  }

  function captureButtonLabel(session: SourceSession) {
    if ($sidebarView.capturePending) {
      return 'Capturing...';
    }
    const remainingSeconds = captureSecondsRemaining(session);
    return remainingSeconds > 0 ? `Listening... ${remainingSeconds}s` : 'Capture now';
  }

  function sessionDisplayStatus(session: SourceSession) {
    if (session.status === 'selected') {
      return 'selected';
    }
    const remainingSeconds = captureSecondsRemaining(session);
    return remainingSeconds > 0 ? `listening ${remainingSeconds}s` : 'waiting for playback';
  }

  function candidateType(candidate: Candidate, probingResolutionUrls: string[], resolutionUnavailableUrls: string[]) {
    const parts = [candidate.contentType ?? candidate.manifestType ?? 'unknown type'];
    if (candidate.resolution) {
      parts.push(candidate.resolution);
    } else if (probingResolutionUrls.includes(candidate.url)) {
      parts.push('checking resolution');
    } else if (resolutionUnavailableUrls.includes(candidate.url)) {
      parts.push('resolution unavailable');
    }
    return parts.join(' / ');
  }

  function subtitleStatus(candidate: Candidate) {
    const tracks = candidate.subtitleTracks ?? [];
    if (tracks.length === 0) {
      return {
        available: false,
        text: 'Detected subtitles: none'
      };
    }
    const labels = [...new Set(tracks.map((track) => subtitleTrackLabel(track)))];
    const visibleLabels = labels.slice(0, 3);
    const extraCount = labels.length - visibleLabels.length;
    const suffix = extraCount > 0 ? `${visibleLabels.join(', ')} +${extraCount}` : visibleLabels.join(', ');
    return {
      available: true,
      text: `Detected subtitles: ${suffix}`
    };
  }

  function subtitleTrackLabel(track: NonNullable<Candidate['subtitleTracks']>[number]) {
    return track.label ?? languageLabel(track.language) ?? subtitleFilenameLabel(track.url) ?? track.format;
  }

  function languageLabel(language: string | null) {
    if (language === 'ru' || language === 'rus') {
      return 'Russian';
    }
    if (language === 'en' || language === 'eng') {
      return 'English';
    }
    return language;
  }

  function subtitleFilenameLabel(url: string) {
    try {
      const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      const stem = filename.replace(/\.[a-z0-9]+$/i, '');
      const tokens = stem.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (tokens.includes('ru') || tokens.includes('rus') || tokens.includes('russian')) {
        return 'Russian';
      }
      if (tokens.includes('en') || tokens.includes('eng') || tokens.includes('english')) {
        return 'English';
      }
      return filename || null;
    } catch {
      return null;
    }
  }

  function collapseButtonLabel(collapsed: boolean) {
    return collapsed ? 'Expand sources' : 'Collapse sources';
  }

  function emptyMessage(session: SourceSession | null) {
    if (!session) {
      return {
        detail: 'Go back to shv and click Choose source.',
        title: 'No active job.'
      };
    }
    if (captureSecondsRemaining(session) > 0) {
      return {
        detail: 'Keep the video playing or seek so the player makes a fresh media request.',
        title: 'Listening for media sources...'
      };
    }
    return {
      detail: 'Start the main video, then use Capture now if the player is embedded or hidden from the page.',
      title: 'No active media sources yet.'
    };
  }
</script>

<aside class:collapsed={$sidebarView.collapsed} class="panel" aria-label="shv sources">
  {#if $sidebarView.collapsed}
    <button
      class="collapse-button rail-button"
      type="button"
      aria-label={collapseButtonLabel($sidebarView.collapsed)}
      onclick={sidebarActions.toggleCollapsed}
    >
      <ChevronLeftIcon />
    </button>
    <span class="rail-label">Sources</span>
  {:else}
    <header>
      <div>
        <h1>Sources</h1>
        <p>{$sidebarView.status}</p>
      </div>
      <div class="header-actions">
        <button
          class="collapse-button"
          type="button"
          aria-label={collapseButtonLabel($sidebarView.collapsed)}
          onclick={sidebarActions.toggleCollapsed}
        >
          <ChevronRightIcon />
        </button>
        <button class="icon-button" type="button" aria-label="Close sources" onclick={sidebarActions.close}>
          <CloseIcon />
        </button>
      </div>
    </header>

    <div class="session-meta">
      {#if $sidebarView.session}
        {@const session = $sidebarView.session}
        <section class="job">
          <strong>{session.titleHint || hostname(session.sourceUrl)}</strong>
          <span>{session.sourceUrl}</span>
          {#if session.status !== 'selected'}
            <button
              class:capturing={$sidebarView.capturePending}
              class="capture-button"
              disabled={$sidebarView.capturePending || captureSecondsRemaining(session) > 0}
              type="button"
              onclick={sidebarActions.startCapture}
            >
              {captureButtonLabel(session)}
            </button>
          {/if}
        </section>
      {/if}

      {#if $sidebarView.selectionError}
        <p class="selection-error" role="alert">{$sidebarView.selectionError}</p>
      {/if}
    </div>

    <section class="sources">
      {#if !$sidebarView.session || visibleSidebarCandidates($sidebarView.session).length === 0}
        {@const message = emptyMessage($sidebarView.session)}
        <div class="empty">
          <strong>{message.title}</strong>
          <p>{message.detail}</p>
        </div>
        <Diagnostics session={$sidebarView.session} />
      {:else}
        {@const sourceSelected = $sidebarView.session.status === 'selected'}
        {@const disabledReason = sourceSelectionDisabledReason($sidebarView.session)}
        {#each visibleSidebarCandidates($sidebarView.session) as candidate (candidate.url)}
          {@const candidateSelected = sourceSelected && $sidebarView.session.selectedUrl === candidate.url}
          {@const subtitles = subtitleStatus(candidate)}
          <article
            class:is-highlighted={$sidebarView.highlightedUrl === candidate.url}
            class:is-selected={candidateSelected}
            class="source"
            data-highlight-kind={candidate.kind}
            data-highlight-source={candidate.url}
            data-source-card="true"
            data-source-url={candidate.url}
            onblur={(event) => {
              if (!(event.currentTarget instanceof HTMLElement) || event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
              }
              sidebarActions.clearHighlight();
            }}
            onfocus={() => sidebarActions.highlight(candidate.url)}
            onfocusin={() => sidebarActions.highlight(candidate.url)}
            onfocusout={(event) => {
              if (!(event.currentTarget instanceof HTMLElement) || event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
              }
              sidebarActions.clearHighlight();
            }}
            onmouseout={(event) => {
              if (!(event.currentTarget instanceof HTMLElement) || event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
              }
              sidebarActions.clearHighlight();
            }}
            onmouseover={() => sidebarActions.highlight(candidate.url)}
          >
            <div class="source-top">
              <strong>{candidate.kind}</strong>
              <span>{Math.round(candidate.confidence * 100)}%</span>
            </div>
            <p>{candidateType(candidate, $sidebarView.probingResolutionUrls, $sidebarView.resolutionUnavailableUrls)}</p>
            <div class:has-subtitles={subtitles.available} class="subtitle-status">{subtitles.text}</div>
            <code>{candidate.url}</code>
            <button
              disabled={sourceSelected || Boolean(disabledReason) || $sidebarView.selectingUrls.includes(candidate.url)}
              type="button"
              onclick={() => sidebarActions.selectSource(candidate.url)}
            >
              {sourceSelectionButtonLabel(candidate, $sidebarView.session, $sidebarView.selectingUrls)}
            </button>
          </article>
        {/each}
      {/if}
    </section>
  {/if}
</aside>

<script lang="ts">
  import type { SourceSession } from './sidebarStore';

  export let session: SourceSession | null;

  function rows(session: SourceSession) {
    const diagnostics = session.diagnostics ?? {};
    const playback = diagnostics.playback as Record<string, any> | null | undefined;
    const network = (diagnostics.network ?? {}) as Record<string, any>;
    const firstVideo = playback?.videos?.[0] ?? null;
    return [
      ['videos', playback ? `${playback.videoCount} total / ${playback.largeVisibleCount} large` : 'no signal yet'],
      ['dominant', playback ? yesNo(playback.dominantFound) : 'unknown'],
      ['active', playback ? yesNo(playback.activeFound) : 'unknown'],
      [
        'first video',
        firstVideo
          ? `${firstVideo.width}x${firstVideo.height}, paused ${yesNo(firstVideo.paused)}, ready ${firstVideo.readyState}, src ${firstVideo.currentSrcKind}`
          : 'none'
      ],
      ['network seen', String(network.observed ?? 0)],
      ['classified', String(network.classified ?? 0)],
      ['mapped', String(network.mapped ?? 0)],
      ['unmapped', String(network.unmapped ?? 0)],
      ['last network', network.lastReason ?? 'none'],
      ['reject', network.lastRejectReason ?? 'none'],
      ['last host', network.lastHost ?? 'none'],
      ['request headers', network.lastHeaderKeys ?? 'none'],
      ['content type', network.lastContentType ?? 'none'],
      ['status/request', network.lastStatusCode != null ? `${network.lastStatusCode} / ${network.lastType ?? 'unknown'}` : 'none'],
      ['path', network.lastPath ?? 'none'],
      ['query keys', network.lastQueryKeys ?? 'none']
    ];
  }

  function yesNo(value: unknown) {
    return value ? 'yes' : 'no';
  }
</script>

{#if session}
  <section class="diagnostics" aria-label="Capture diagnostics">
    <strong>Diagnostics</strong>
    {#each rows(session) as [label, value]}
      <p>
        <span>{label}</span>
        <code>{value}</code>
      </p>
    {/each}
  </section>
{/if}

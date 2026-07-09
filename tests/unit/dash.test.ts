import { describe, expect, test } from 'vitest';
import { parseDashRepresentations, selectBestDashRepresentation, selectBestDashRenditions } from '../../src/server/download-engine/dash.js';

describe('DASH parsing', () => {
  const manifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="360" bandwidth="700000" width="640" height="360"><BaseURL>360/video.mp4</BaseURL></Representation>
      <Representation id="1080" bandwidth="4200000" width="1920" height="1080"><BaseURL>1080/video.mp4</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

  test('selects the highest-bandwidth representation', () => {
    const selected = selectBestDashRepresentation(manifest, 'https://example.test/manifest.mpd');
    expect(selected?.id).toBe('1080');
    expect(selected?.baseUrl).toBe('https://example.test/1080/video.mp4');
  });

  test('returns sorted representations with dimensions', () => {
    const representations = parseDashRepresentations(manifest, 'https://example.test/manifest.mpd');
    expect(representations.map((representation) => representation.height)).toEqual([1080, 360]);
  });

  test('decodes XML entities in BaseURL query strings', () => {
    const escapedManifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/webm">
      <Representation id="720" bandwidth="2200000" width="1280" height="720">
        <BaseURL>https://media.example.test/video?expires=1&amp;type=7&amp;sig=abc</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    const selected = selectBestDashRepresentation(escapedManifest, 'https://example.test/manifest.mpd');
    expect(selected?.baseUrl).toBe('https://media.example.test/video?expires=1&type=7&sig=abc');
  });

  test('decodes CDATA BaseURL values from contentType adaptation sets', () => {
    const cdataManifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="720" bandwidth="2200000" width="1280" height="720">
        <BaseURL><![CDATA[../video/720.mp4?token=a&amp;b]]></BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    const selected = selectBestDashRepresentation(cdataManifest, 'https://example.test/manifests/manifest.mpd');
    expect(selected?.baseUrl).toBe('https://example.test/video/720.mp4?token=a&b');
  });

  test('selects separate audio and video renditions when DASH splits streams', () => {
    const splitManifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet mimeType="video/webm">
      <Representation id="video-low" bandwidth="700000" width="640" height="360"><BaseURL>360/video.webm</BaseURL></Representation>
      <Representation id="video-high" bandwidth="4200000" width="1920" height="1080"><BaseURL>1080/video.webm</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/webm">
      <Representation id="audio-low" bandwidth="64000"><BaseURL>audio-low.webm</BaseURL></Representation>
      <Representation id="audio-high" bandwidth="128000"><BaseURL>audio-high.webm</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

    const selected = selectBestDashRenditions(splitManifest, 'https://example.test/manifest.mpd');

    expect(selected.video?.id).toBe('video-high');
    expect(selected.video?.baseUrl).toBe('https://example.test/1080/video.webm');
    expect(selected.audio?.id).toBe('audio-high');
    expect(selected.audio?.baseUrl).toBe('https://example.test/audio-high.webm');
  });

  test('parses namespaced self-closing representations and ignores commented markup', () => {
    const namespacedManifest = `<?xml version="1.0"?>
<dash:MPD xmlns:dash="urn:mpeg:dash:schema:mpd:2011">
  <dash:Period>
    <dash:AdaptationSet contentType="video">
      <!-- <Representation id="commented" bandwidth="9999999"><BaseURL>wrong.mp4</BaseURL></Representation> -->
      <dash:BaseURL>video.mp4</dash:BaseURL>
      <dash:Representation id="self-closing" bandwidth="2200000" width="1280" height="720" />
    </dash:AdaptationSet>
  </dash:Period>
</dash:MPD>`;

    expect(parseDashRepresentations(namespacedManifest, 'https://example.test/manifest.mpd')).toEqual([
      {
        id: 'self-closing',
        bandwidth: 2200000,
        width: 1280,
        height: 720,
        baseUrl: 'https://example.test/video.mp4'
      }
    ]);
  });

  test('does not treat a manifest URL as a playable representation URL', () => {
    const segmentedManifest = `<?xml version="1.0"?>
<MPD>
  <Period>
    <AdaptationSet contentType="video">
      <SegmentTemplate media="segment-$Number$.m4s" initialization="init.m4s" />
      <Representation id="segmented" bandwidth="2200000" />
    </AdaptationSet>
  </Period>
</MPD>`;

    expect(parseDashRepresentations(segmentedManifest, 'https://example.test/manifest.mpd')).toEqual([]);
  });
});

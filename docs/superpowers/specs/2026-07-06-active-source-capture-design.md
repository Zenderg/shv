# Active Source Capture Design

Manual source selection should show sources related to the video the user actually starts, not every media-looking request on a noisy source page.

The extension treats playback from a visible, dominant `<video>` element as the activation signal. While playback is active, the service worker accepts network candidates for a short rolling window. Outside that window, page preloads, recommendations, ad previews, and background media requests are ignored.

Some embedded players stream media without exposing a usable DOM `<video>` to content scripts. The sidebar therefore provides a manual Capture now action: the user starts playback and opens the same short active capture window explicitly.

Candidate filtering must match the backend downloader contract: browser-local URLs, explicit byte-range URLs such as `?bytes=0-6402`, and generic chunk-like responses are not standalone downloadable sources and should not appear in the Sources panel. The primary list should favor manifests (`.mpd`, `.m3u8`) and complete direct video URLs.

Network candidates must include enough browser request context for the server downloader to retry the URL. The extension stores a limited allowlist of request headers during capture. On the explicit `Use source` action, it also collects cookies for the source page and selected media URLs, sends only those cookies to the local backend, and attaches matching `Cookie` headers to candidates.

Hover highlighting is secondary. It should only show a page overlay for exact DOM URL matches or one obvious dominant player. It must not imply that a small preview tile is the selected source.

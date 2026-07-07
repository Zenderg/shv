# Dev Library Seed Design

Local UI development needs a fast way to fill the library with fake categories and media rows without exercising the downloader or media-processing pipeline.

The seed workflow is explicitly local and command-driven. It should be run by an agent or developer on request, not automatically during application startup. The application itself should continue to start only through Docker Compose, while seed/check commands may run locally.

The default command adds data to the existing local library. This keeps real manual test data intact and lets developers grow the library to stress the UI. A separate reset command removes only rows and files created by the seed workflow.

Seeded media does not need playable video content. Each media item should get a tiny placeholder file with an `.mp4` filename so list, card, file path, rename, move, and delete behavior can be exercised cheaply. The files are intentionally not a media-pipeline test fixture.

Seed rows must be easy and safe to identify. Media rows should use a `dev-seed://...` source URL, and seed categories should use a `[dev] ` display-name prefix. Reset deletes media rows with that source URL scheme, removes their owned placeholder files and thumbnails, and removes only empty `[dev] ` categories after media deletion.

The generated data should include UI edge cases: long category names, long titles, unicode text, missing thumbnails, mixed durations, mixed dimensions, mixed containers/codecs, and uneven category sizes. Defaults should be large enough to make the library useful immediately, while command flags can request more categories or videos.

The implementation should reuse the existing `CategoryService`, `MediaFiles`, `MediaLibraryService`, and database migration path instead of manually bypassing project rules. Documentation should live in development notes so future agents can run and clean up the seed data without rediscovering the workflow.

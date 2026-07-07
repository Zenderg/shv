# Release Workflow

`shv` publishes release images to GitHub Container Registry (GHCR). The release artifact users should deploy is the Docker image, not a source checkout.

## Release Contract

- Releases are cut only from `main`.
- Release tags use `vX.Y.Z`, for example `v1.2.3`.
- Pushing a release tag starts the GitHub Actions release workflow.
- The workflow installs `ffmpeg`/`ffprobe`, then runs `npm test`, `npm run typecheck`, and `npm run build` before publishing an image.
- The workflow publishes these image tags:
  - `ghcr.io/zenderg/shv:vX.Y.Z`
  - `ghcr.io/zenderg/shv:X.Y.Z`
  - `ghcr.io/zenderg/shv:latest`
- The workflow creates a draft GitHub Release with the image link, digest, and a Docker Compose snippet.
- If the GitHub Release already exists, the workflow leaves its notes untouched so reruns do not overwrite edited release notes.
- Codex writes the final user-facing release notes before the release is published.

Release notes live in GitHub Releases, not in a repository changelog file.

After the first image publish, verify that the GHCR package is public and linked to the repository so users can pull it without authentication.

## Commit Messages

Use short conventional commit prefixes so the release notes can be summarized cleanly:

- `feat:` for user-facing features.
- `fix:` for bug fixes.
- `docs:` for documentation-only changes.
- `chore:` for maintenance that does not affect runtime behavior.
- `refactor:` for behavior-preserving code restructuring.
- `test:` for test-only changes.
- `build:` for build, CI, Docker, or release pipeline changes.

The prefixes are a release-writing aid, not a substitute for reviewing the diff.

## Cutting a Release

1. Make sure `main` contains the release commit.
2. Inspect the changes since the previous release:

   ```bash
   git describe --tags --abbrev=0
   git log --oneline <previous-tag>..HEAD
   ```

   For the first release, when no previous tag exists yet, use `git log --oneline HEAD`.

3. Create and push an annotated tag:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

4. Wait for the `Release` workflow to complete.
5. Open the draft GitHub Release created for the tag.
6. Replace the draft release-notes section with a concise user-facing changelog:
   - what changed;
   - what was fixed;
   - any deployment notes or breaking changes;
   - the final image link.
7. Publish the GitHub Release.

## User Deployment

Use the versioned image tag from the release page. Example:

```yaml
services:
  shv:
    image: ghcr.io/zenderg/shv:vX.Y.Z
    container_name: shv
    restart: unless-stopped
    ports:
      - "${SHV_PORT:-8080}:8080"
    environment:
      PORT: "8080"
      HOST: "0.0.0.0"
      LIBRARY_ROOT: "/data/library"
      APP_DATA_ROOT: "/data/app"
      WORK_ROOT: "/work"
    volumes:
      - ./data/library:/data/library
      - ./data/app:/data/app
      - ./data/work:/work
```

Then run:

```bash
docker compose up -d
```

The application remains intended for a trusted home LAN or VPN. Do not expose it directly to the public internet.

import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/appConfig.js';
import { assertInsideRoot } from '../utils/fileSafety.js';

export function cleanupCanceledArtifacts(
  config: AppConfig,
  jobId: string,
  finalPath: string | null,
  thumbnailPath: string | null
): void {
  for (const filePath of [finalPath, thumbnailPath]) {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
  cleanupJobArtifacts(config, jobId);
}

export function cleanupJobArtifacts(config: AppConfig, jobId: string): void {
  const paths = [
    artifactPath(config.workRoot, jobId),
    artifactPath(path.join(config.appDataRoot, 'manual-screenshots'), `${jobId}.png`),
    artifactPath(path.join(config.appDataRoot, 'live-browser-profiles'), jobId),
    artifactPath(config.thumbnailsRoot, `${jobId}.jpg`)
  ];
  for (const artifactPath of paths) {
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { recursive: true, force: true });
    }
  }
}

export function cleanupCompletedWorkDir(config: AppConfig, jobId: string): void {
  const workDir = artifactPath(config.workRoot, jobId);
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function artifactPath(root: string, relativePath: string): string {
  return assertInsideRoot(root, path.join(root, relativePath));
}

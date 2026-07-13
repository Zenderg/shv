import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CategoryService } from '../../src/server/categories/categoryService.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { JobService } from '../../src/server/jobs/jobService.js';
import { MediaFiles } from '../../src/server/media-library/mediaFiles.js';
import { MediaLibraryService } from '../../src/server/media-library/mediaLibraryService.js';
import { openDatabase } from '../../src/server/storage/database.js';

describe('MediaLibraryService', () => {
  test('stores the final probed video dimensions on media items', () => {
    const { categories, config, mediaLibrary } = createServices();
    const category = categories.create('test');
    const finalFilePath = path.join(config.libraryRoot, category.folderName, 'video.mp4');
    fs.mkdirSync(path.dirname(finalFilePath), { recursive: true });
    fs.writeFileSync(finalFilePath, 'video');

    const item = mediaLibrary.create({
      audioCodec: 'aac',
      categoryId: category.id,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSeconds: 12,
      finalFilePath,
      height: 1080,
      sizeBytes: 5,
      sourceUrl: 'https://example.test/video',
      thumbnailPath: null,
      title: 'video',
      videoCodec: 'h264',
      width: 1920
    });

    expect(item.width).toBe(1920);
    expect(item.height).toBe(1080);
    expect(mediaLibrary.get(item.id)).toMatchObject({ width: 1920, height: 1080 });
  });

  test('atomically and idempotently links one completed media item to its job', () => {
    const { categories, config, db, jobs, mediaFiles, mediaLibrary } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    const claimed = jobs.claimNextRunnableJob()!;
    jobs.transitionActive(job.id, claimed.runId, 'analyzing', 'downloading', null);
    jobs.transitionActive(job.id, claimed.runId, 'downloading', 'processing', null);
    const finalFilePath = path.join(config.libraryRoot, category.folderName, 'video.mp4');
    const relativePath = mediaFiles.relativeMediaPath(finalFilePath);
    expect(jobs.reserveOutputPath(job.id, claimed.runId, relativePath).reserved).toBe(true);
    fs.mkdirSync(path.dirname(finalFilePath), { recursive: true });
    fs.writeFileSync(finalFilePath, 'video');
    const input = {
      audioCodec: 'aac',
      categoryId: category.id,
      container: 'mp4',
      durationSeconds: 12,
      finalFilePath,
      height: 1080,
      sizeBytes: 5,
      sourceUrl: job.sourceUrl,
      thumbnailPath: null,
      title: 'video',
      videoCodec: 'h264',
      width: 1920
    };

    const first = mediaLibrary.completeJob(job.id, claimed.runId, input);
    const repeated = mediaLibrary.completeJob(job.id, claimed.runId, input);

    expect(repeated.id).toBe(first.id);
    expect(mediaLibrary.list()).toHaveLength(1);
    expect(jobs.requireJob(job.id)).toMatchObject({ status: 'completed', stageProgress: 1 });
    expect(jobs.outputRelativePath(job.id)).toBeNull();
    expect((db.prepare('SELECT job_id FROM media_items WHERE id = ?').get(first.id) as { job_id: string }).job_id).toBe(job.id);
  });
});

function createServices() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-library-'));
  const appDataRoot = path.join(root, 'app');
  const config: AppConfig = {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'db.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(root, 'library'),
    port: 0,
    sourceExtensionProfile: 'prod',
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'youtube-cookies.txt')
  };
  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
  const mediaFiles = new MediaFiles(config, categories);
  const mediaLibrary = new MediaLibraryService(db, categories, mediaFiles);
  const jobs = new JobService(db);
  return { categories, config, db, jobs, mediaFiles, mediaLibrary };
}

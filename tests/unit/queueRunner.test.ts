import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { BrowserAnalyzer } from '../../src/server/browser-analyzer/browserAnalyzer.js';
import { CategoryService } from '../../src/server/categories/categoryService.js';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import type { DownloadEngine } from '../../src/server/download-engine/downloadEngine.js';
import { JobService } from '../../src/server/jobs/jobService.js';
import { QueueRunner, subtitleTracksForDownload } from '../../src/server/jobs/queueRunner.js';
import type { MediaFiles } from '../../src/server/media-library/mediaFiles.js';
import type { MediaLibraryService } from '../../src/server/media-library/mediaLibraryService.js';
import type { MediaProcessor } from '../../src/server/media-processing/mediaProcessor.js';
import { openDatabase } from '../../src/server/storage/database.js';
import { JobCanceledError } from '../../src/server/utils/cancellation.js';
import type { MediaCandidate, SubtitleTrack } from '../../src/shared/types.js';

describe('QueueRunner', () => {
  test('downloads only the selected subtitle track', () => {
    expect(
      subtitleTracksForDownload({
        ...mediaCandidate('https://media.example.test/video.mp4'),
        subtitleTracks: [
          subtitleTrack('https://media.example.test/subtitles/ru.ass', { isSelected: true, label: 'Russian' }),
          subtitleTrack('https://media.example.test/subtitles/en.ass', { isSelected: false, label: 'English' })
        ]
      })
    ).toEqual([subtitleTrack('https://media.example.test/subtitles/ru.ass', { isSelected: true, label: 'Russian' })]);
  });

  test('downloads no subtitle tracks when the player selection is off or unknown', () => {
    expect(
      subtitleTracksForDownload({
        ...mediaCandidate('https://media.example.test/video.mp4'),
        subtitleTracks: [
          subtitleTrack('https://media.example.test/subtitles/ru.ass', { isSelected: false, label: 'Russian' }),
          subtitleTrack('https://media.example.test/subtitles/en.ass', { isSelected: false, label: 'English' })
        ]
      })
    ).toEqual([]);

    expect(
      subtitleTracksForDownload({
        ...mediaCandidate('https://media.example.test/video.mp4'),
        subtitleTracks: [subtitleTrack('https://media.example.test/subtitles/ru.ass', { isSelected: null, label: 'Russian' })]
      })
    ).toEqual([]);
  });

  test('aborts the active pipeline when a running job is canceled', async () => {
    const { categories, config, jobs } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    jobs.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4')]);
    jobs.selectCandidate(job.id, jobs.listCandidates(job.id)[0].id);

    const started = deferred<void>();
    const downloader = {
      download: (_candidate, _outputPath, _onProgress, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          started.resolve();
          signal?.addEventListener('abort', () => reject(new JobCanceledError()), { once: true });
        })
    } satisfies Pick<DownloadEngine, 'download'>;
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      {} as MediaProcessor,
      categories,
      {} as MediaFiles,
      {} as MediaLibraryService
    );

    const tick = runner.tick();
    await started.promise;
    const canceled = runner.cancel(job.id);
    await tick;

    expect(canceled.status).toBe('canceled');
    expect(jobs.requireJob(job.id).status).toBe('canceled');
  });

  test('removes job-owned artifacts when a running job is canceled', async () => {
    const { categories, config, jobs } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    jobs.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4')]);
    jobs.selectCandidate(job.id, jobs.listCandidates(job.id)[0].id);

    const started = deferred<void>();
    const downloader = {
      download: (_candidate, _outputPath, _onProgress, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          started.resolve();
          signal?.addEventListener('abort', () => reject(new JobCanceledError()), { once: true });
        })
    } satisfies Pick<DownloadEngine, 'download'>;
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      {} as MediaProcessor,
      categories,
      {} as MediaFiles,
      {} as MediaLibraryService
    );

    const tick = runner.tick();
    await started.promise;
    const workDir = path.join(config.workRoot, job.id);
    const manualScreenshot = path.join(config.appDataRoot, 'manual-screenshots', `${job.id}.png`);
    const browserProfile = path.join(config.appDataRoot, 'live-browser-profiles', job.id);
    fs.mkdirSync(path.dirname(manualScreenshot), { recursive: true });
    fs.mkdirSync(browserProfile, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'source'), 'partial');
    fs.writeFileSync(manualScreenshot, 'screenshot');
    fs.writeFileSync(path.join(browserProfile, 'profile'), 'profile');

    runner.cancel(job.id);
    await tick;

    expect(jobs.requireJob(job.id).status).toBe('canceled');
    expect(fs.existsSync(workDir)).toBe(false);
    expect(fs.existsSync(manualScreenshot)).toBe(false);
    expect(fs.existsSync(browserProfile)).toBe(false);
  });

  test('fails a job when downloading stalls without progress', async () => {
    const { categories, config, jobs } = createServices();
    config.downloadStallTimeoutMs = 20;
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    jobs.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4')]);
    jobs.selectCandidate(job.id, jobs.listCandidates(job.id)[0].id);

    const started = deferred<void>();
    const downloader = {
      download: (_candidate, _outputPath, _onProgress, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          started.resolve();
          signal?.addEventListener('abort', () => reject(new JobCanceledError()), { once: true });
        })
    } satisfies Pick<DownloadEngine, 'download'>;
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      {} as MediaProcessor,
      categories,
      {} as MediaFiles,
      {} as MediaLibraryService
    );

    const tick = runner.tick();
    await started.promise;

    await expect(Promise.race([tick.then(() => 'finished'), delay(200).then(() => 'timed-out')])).resolves.toBe('finished');
    const failed = jobs.requireJob(job.id);
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toContain('Download stalled');
  });

  test('keeps a download alive when progress advances in tiny increments', async () => {
    const { categories, config, jobs } = createServices();
    config.downloadStallTimeoutMs = 20;
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    jobs.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4')]);
    jobs.selectCandidate(job.id, jobs.listCandidates(job.id)[0].id);

    const downloader = {
      download: async (_candidate, outputPath, onProgress, signal?: AbortSignal) => {
        for (const progress of [0.0005, 0.001, 0.0015, 0.002, 0.0025]) {
          await delay(10);
          if (signal?.aborted) {
            throw new JobCanceledError();
          }
          onProgress(progress);
        }
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'source-video');
        return { bytesWritten: 12, filePath: outputPath };
      }
    } satisfies Pick<DownloadEngine, 'download'>;
    const processor = {
      normalize: async (_inputPath, outputPath, thumbnailPath) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        fs.writeFileSync(outputPath, 'normalized');
        return {
          audioCodec: 'aac',
          browserFriendly: true,
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          durationSeconds: 1,
          height: 1080,
          outputPath,
          processingStrategy: 'transcoded',
          sizeBytes: 10,
          thumbnailPath: null,
          videoCodec: 'h264',
          width: 1920
        };
      }
    } satisfies Pick<MediaProcessor, 'normalize'>;
    const mediaFiles = {
      finalVideoPath: () => path.join(config.libraryRoot, 'test', 'video.mp4'),
      thumbnailPath: () => path.join(config.thumbnailsRoot, `${job.id}.jpg`)
    } satisfies Pick<MediaFiles, 'finalVideoPath' | 'thumbnailPath'>;
    const mediaLibrary = {
      create: () => mediaItem(category.id, job.id, job.sourceUrl)
    } satisfies Pick<MediaLibraryService, 'create'>;
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      processor as unknown as MediaProcessor,
      categories,
      mediaFiles as unknown as MediaFiles,
      mediaLibrary as unknown as MediaLibraryService
    );

    await runner.tick();

    const completed = jobs.requireJob(job.id);
    expect(completed.status).toBe('completed');
    expect(completed.errorMessage).toBeNull();
  });

  test('deletes a queued job and removes job-owned artifacts', () => {
    const { categories, config, jobs } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://example.test/video', category.id);
    jobs.saveCandidates(job.id, [candidate('https://media.example.test/video.mp4')]);
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      {} as DownloadEngine,
      {} as MediaProcessor,
      categories,
      {} as MediaFiles,
      {} as MediaLibraryService
    );
    const workDir = path.join(config.workRoot, job.id);
    const manualScreenshot = path.join(config.appDataRoot, 'manual-screenshots', `${job.id}.png`);
    const thumbnail = path.join(config.thumbnailsRoot, `${job.id}.jpg`);
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(path.dirname(manualScreenshot), { recursive: true });
    fs.mkdirSync(path.dirname(thumbnail), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'source'), 'partial');
    fs.writeFileSync(manualScreenshot, 'screenshot');
    fs.writeFileSync(thumbnail, 'thumbnail');

    runner.delete(job.id);

    expect(jobs.get(job.id)).toBeNull();
    expect(jobs.listCandidates(job.id)).toEqual([]);
    expect(fs.existsSync(workDir)).toBe(false);
    expect(fs.existsSync(manualScreenshot)).toBe(false);
    expect(fs.existsSync(thumbnail)).toBe(false);
  });

  test('requires manual selection for browser requests discovered inside a page', async () => {
    const { categories, config, jobs } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://example.test/watch/embedded-player', category.id);
    const analyzer = {
      analyze: async () => ({
        candidates: [
          {
            ...candidate('https://media.example.test/video.mp4'),
            kind: 'browser-request' as const,
            confidence: 0.86,
            headers: { referer: 'https://example.test/watch/embedded-player' }
          }
        ],
        diagnostics: [],
        screenshotPath: null,
        titleHint: 'Embedded Player'
      })
    } satisfies Pick<BrowserAnalyzer, 'analyze'>;
    let downloaderCalled = false;
    const downloader = {
      download: async () => {
        downloaderCalled = true;
        throw new Error('manual-selection candidate should not download automatically');
      }
    } satisfies Pick<DownloadEngine, 'download'>;
    const runner = new QueueRunner(
      config,
      jobs,
      analyzer as unknown as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      {} as MediaProcessor,
      categories,
      {} as MediaFiles,
      {} as MediaLibraryService
    );

    await runner.tick();

    const updated = jobs.requireJob(job.id);
    expect(updated.status).toBe('needs_manual_selection');
    expect(updated.selectedCandidateId).toBeNull();
    expect(downloaderCalled).toBe(false);
  });

  test('uses a source extractor for YouTube even when a stale manual candidate is selected', async () => {
    const { categories, config, jobs } = createServices();
    const category = categories.create('test');
    const job = jobs.create('https://www.youtube.com/watch?v=test', category.id);
    jobs.saveCandidates(job.id, [candidate('https://rr1---sn-test.googlevideo.com/videoplayback?itag=18&mime=video%2Fmp4')]);
    jobs.selectCandidate(job.id, jobs.listCandidates(job.id)[0].id);

    let downloaderCalled = false;
    let extractorCalled = false;
    const downloader = {
      download: async () => {
        downloaderCalled = true;
        throw new Error('remote candidate downloader should not run for YouTube');
      }
    } satisfies Pick<DownloadEngine, 'download'>;
    const sourceExtractors = {
      canHandle: (sourceUrl: string) => sourceUrl.includes('youtube.com'),
      download: async (_sourceUrl: string, outputPath: string) => {
        extractorCalled = true;
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'youtube-extractor-video');
        return { bytesWritten: 23, filePath: outputPath };
      }
    };
    const processor = {
      normalize: async (_inputPath, outputPath, thumbnailPath) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
        fs.writeFileSync(outputPath, 'normalized');
        return {
          audioCodec: 'aac',
          browserFriendly: true,
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          durationSeconds: 1,
          height: 1080,
          outputPath,
          processingStrategy: 'transcoded',
          sizeBytes: 10,
          thumbnailPath: null,
          videoCodec: 'h264',
          width: 1920
        };
      }
    } satisfies Pick<MediaProcessor, 'normalize'>;
    const mediaFiles = {
      finalVideoPath: () => path.join(config.libraryRoot, 'test', 'youtube.mp4'),
      thumbnailPath: () => path.join(config.thumbnailsRoot, `${job.id}.jpg`)
    } satisfies Pick<MediaFiles, 'finalVideoPath' | 'thumbnailPath'>;
    const mediaLibrary = {
      create: () => mediaItem(category.id, job.id, job.sourceUrl)
    } satisfies Pick<MediaLibraryService, 'create'>;
    const runner = new QueueRunner(
      config,
      jobs,
      {} as BrowserAnalyzer,
      downloader as unknown as DownloadEngine,
      processor as unknown as MediaProcessor,
      categories,
      mediaFiles as unknown as MediaFiles,
      mediaLibrary as unknown as MediaLibraryService,
      sourceExtractors
    );

    await runner.tick();

    expect(extractorCalled).toBe(true);
    expect(downloaderCalled).toBe(false);
    expect(jobs.requireJob(job.id).status).toBe('completed');
  });
});

function createServices() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-runner-'));
  const appDataRoot = path.join(root, 'app');
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    libraryRoot: path.join(root, 'library'),
    appDataRoot,
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    browserDataRoot: path.join(appDataRoot, 'browser'),
    sourceExtensionProfile: 'prod',
    workRoot: path.join(root, 'work'),
    databasePath: path.join(appDataRoot, 'db.sqlite'),
    chromiumExecutablePath: undefined,
    ytDlpCookiesPath: path.join(appDataRoot, 'youtube-cookies.txt'),
    downloadStallTimeoutMs: 120_000
  };
  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
  const jobs = new JobService(db);
  return { categories, config, jobs };
}

function candidate(url: string) {
  return {
    kind: 'direct' as const,
    url,
    contentType: 'video/mp4',
    manifestType: null,
    resolution: null,
    bitrate: null,
    durationSeconds: null,
    sizeBytes: null,
    confidence: 0.9,
    headers: {},
    subtitleTracks: []
  };
}

function mediaCandidate(url: string): MediaCandidate {
  return {
    ...candidate(url),
    discoveredAt: new Date().toISOString(),
    id: 'candidate-id',
    jobId: 'job-id'
  };
}

function subtitleTrack(url: string, patch: Partial<SubtitleTrack> = {}): SubtitleTrack {
  return {
    ...subtitleTrackBase(url),
    ...patch
  };
}

function subtitleTrackBase(url: string): SubtitleTrack {
  return {
    contentType: 'text/x-ssa',
    format: 'ass' as const,
    isDefault: null,
    isSelected: null,
    label: null,
    language: null,
    source: 'network' as const,
    url
  };
}

function mediaItem(categoryId: string, id: string, sourceUrl: string) {
  return {
    audioCodec: 'aac',
    categoryId,
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    createdAt: new Date().toISOString(),
    durationSeconds: 1,
    filename: 'video.mp4',
    height: 1080,
    id,
    relativePath: 'test/video.mp4',
    sizeBytes: 10,
    sourceUrl,
    thumbnailPath: null,
    title: 'video',
    updatedAt: new Date().toISOString(),
    videoCodec: 'h264',
    width: 1920
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

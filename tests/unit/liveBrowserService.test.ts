import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppConfig } from '../../src/server/config/appConfig.js';
import { JobService } from '../../src/server/jobs/jobService.js';
import { LiveBrowserService } from '../../src/server/browser-live/liveBrowserService.js';
import { type Db, openDatabase } from '../../src/server/storage/database.js';

const playwrightMocks = vi.hoisted(() => ({
  launchPersistentContext: vi.fn(),
  contextClose: vi.fn(),
  newPage: vi.fn(),
  pageContent: vi.fn(),
  pageGoto: vi.fn(),
  pageOn: vi.fn(),
  pageTitle: vi.fn(),
  pageUrl: vi.fn(),
  waitForTimeout: vi.fn()
}));

vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: playwrightMocks.launchPersistentContext
  }
}));

describe('LiveBrowserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playwrightMocks.contextClose.mockResolvedValue(undefined);
    playwrightMocks.newPage.mockResolvedValue({
      content: playwrightMocks.pageContent,
      goto: playwrightMocks.pageGoto,
      on: playwrightMocks.pageOn,
      title: playwrightMocks.pageTitle,
      url: playwrightMocks.pageUrl,
      waitForTimeout: playwrightMocks.waitForTimeout
    });
    playwrightMocks.launchPersistentContext.mockResolvedValue({
      close: playwrightMocks.contextClose,
      newPage: playwrightMocks.newPage
    });
    playwrightMocks.pageContent.mockResolvedValue('');
    playwrightMocks.pageTitle.mockResolvedValue(null);
    playwrightMocks.pageUrl.mockReturnValue('about:blank');
    playwrightMocks.waitForTimeout.mockResolvedValue(undefined);
  });

  test('cleans up the browser session when initial navigation fails', async () => {
    const { config, db, jobs } = createServices();
    const job = jobs.create('https://example.test/unreachable', createCategory(db));
    playwrightMocks.pageGoto.mockRejectedValue(new Error('navigation failed'));
    const service = new LiveBrowserService(config, jobs);

    const started = await service.start(job.id);
    const state = await service.state(job.id);

    expect(playwrightMocks.contextClose).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({
      jobId: job.id,
      running: false,
      currentUrl: null,
      title: null,
      errorMessage: 'navigation failed'
    });
    expect(state.running).toBe(false);
  });

  test('captures complete replay-safe request headers for detected media', async () => {
    const { config, db, jobs } = createServices();
    const job = jobs.create('https://example.test/watch', createCategory(db));
    const service = new LiveBrowserService(config, jobs);
    await service.start(job.id);

    const responseListener = playwrightMocks.pageOn.mock.calls.find(([event]) => event === 'response')?.[1];
    const allHeaders = vi.fn().mockResolvedValue({
      authorization: 'Bearer media-token',
      host: 'media.example.test',
      origin: 'https://example.test',
      'sec-fetch-dest': 'video',
      'x-media-token': 'custom-token'
    });
    responseListener({
      headers: () => ({ 'content-type': 'video/mp4' }),
      request: () => ({ allHeaders }),
      url: () => 'https://media.example.test/video.mp4'
    });

    await vi.waitFor(() => expect(jobs.listCandidates(job.id)).toHaveLength(1));
    expect(allHeaders).toHaveBeenCalledTimes(1);
    expect(jobs.listCandidates(job.id)[0]?.headers).toEqual({
      authorization: 'Bearer media-token',
      origin: 'https://example.test',
      'sec-fetch-dest': 'video',
      'x-media-token': 'custom-token'
    });
  });
});

function createServices() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-live-browser-'));
  const db = openDatabase(path.join(root, 'db.sqlite'));
  const jobs = new JobService(db);
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    sourceExtensionProfile: 'prod',
    libraryRoot: path.join(root, 'library'),
    appDataRoot: path.join(root, 'app'),
    thumbnailsRoot: path.join(root, 'app', 'thumbnails'),
    browserDataRoot: path.join(root, 'app', 'browser'),
    workRoot: path.join(root, 'work'),
    databasePath: path.join(root, 'db.sqlite'),
    chromiumExecutablePath: undefined,
    ytDlpCookiesPath: path.join(root, 'app', 'youtube-cookies.txt')
  };
  return { config, db, jobs };
}

function createCategory(db: Db): string {
  const categoryId = '7b2d8d17-a7dd-4f1d-b143-82ed9b70dbd6';
  db.prepare('INSERT INTO categories (id, name, folder_name, created_at) VALUES (?, ?, ?, ?)').run(
    categoryId,
    'test',
    'test',
    new Date().toISOString()
  );
  return categoryId;
}

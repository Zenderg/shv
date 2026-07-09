import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createCsrfToken, createRouter, errorHandler } from './api/routes.js';
import { BrowserAnalyzer } from './browser-analyzer/browserAnalyzer.js';
import { LiveBrowserService } from './browser-live/liveBrowserService.js';
import { CategoryService } from './categories/categoryService.js';
import { loadAppConfig } from './config/appConfig.js';
import { DownloadEngine } from './download-engine/downloadEngine.js';
import { ExtensionDebugService } from './extension-debug/extensionDebugService.js';
import { JobService } from './jobs/jobService.js';
import { QueueRunner } from './jobs/queueRunner.js';
import { MediaFiles } from './media-library/mediaFiles.js';
import { MediaLibraryService } from './media-library/mediaLibraryService.js';
import { MediaProcessor } from './media-processing/mediaProcessor.js';
import { YtDlpSourceExtractor } from './source-extractors/sourceExtractorService.js';
import { openDatabase } from './storage/database.js';

export function createApp() {
  const config = loadAppConfig();
  fs.mkdirSync(config.libraryRoot, { recursive: true });
  fs.mkdirSync(config.appDataRoot, { recursive: true });
  fs.mkdirSync(config.thumbnailsRoot, { recursive: true });
  fs.mkdirSync(config.workRoot, { recursive: true });

  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
  categories.ensureDefaultCategory();
  const jobs = new JobService(db);
  jobs.recoverInterruptedJobs();
  const mediaFiles = new MediaFiles(config, categories);
  const mediaLibrary = new MediaLibraryService(db, categories, mediaFiles);
  const analyzer = new BrowserAnalyzer(config);
  const liveBrowser = new LiveBrowserService(config, jobs);
  const downloader = new DownloadEngine();
  const extensionDebug = new ExtensionDebugService();
  const processor = new MediaProcessor();
  const sourceExtractors = new YtDlpSourceExtractor({ cookiesPath: config.ytDlpCookiesPath });
  const queueRunner = new QueueRunner(config, jobs, analyzer, downloader, processor, categories, mediaFiles, mediaLibrary, sourceExtractors);
  const csrfToken = createCsrfToken();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(createRouter({ config, csrfToken, categories, extensionDebug, jobs, queueRunner, liveBrowser, mediaFiles, mediaLibrary }));

  const webRoot = resolveWebRoot();
  if (fs.existsSync(webRoot)) {
    app.use(express.static(webRoot));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(webRoot, 'index.html'));
    });
  }

  app.use(errorHandler);
  return { app, queueRunner, config, db };
}

if (process.env.NODE_ENV !== 'test') {
  const { app, queueRunner, config } = createApp();
  queueRunner.start();
  app.listen(config.port, config.host, () => {
    console.log(`shv listening on http://${config.host}:${config.port}`);
  });
}

function resolveWebRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const distCandidate = path.resolve(path.dirname(currentFile), '../web');
  const devCandidate = path.resolve(process.cwd(), 'dist/web');
  return fs.existsSync(distCandidate) ? distCandidate : devCandidate;
}

import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import mime from 'mime-types';
import { z } from 'zod';
import type { CandidateDraft } from '../candidate-detection/candidateDetection.js';
import type { AppConfig } from '../config/appConfig.js';
import { CategoryConflictError, type CategoryService } from '../categories/categoryService.js';
import type { JobService } from '../jobs/jobService.js';
import type { QueueRunner } from '../jobs/queueRunner.js';
import type { LiveBrowserService } from '../browser-live/liveBrowserService.js';
import type { MediaFiles } from '../media-library/mediaFiles.js';
import type { MediaLibraryService } from '../media-library/mediaLibraryService.js';
import { buildZipArchive, type ZipEntryInput } from '../utils/zipArchive.js';
import {
  DEV_SOURCE_EXTENSION_ID,
  PROD_SOURCE_EXTENSION_ID,
  sourceExtensionProfile,
  type SourceExtensionProfile
} from '../../shared/sourceExtension.js';

export { DEV_SOURCE_EXTENSION_ID, PROD_SOURCE_EXTENSION_ID, sourceExtensionProfile };

export interface RouteServices {
  config: AppConfig;
  categories: CategoryService;
  jobs: JobService;
  queueRunner: QueueRunner;
  liveBrowser: LiveBrowserService;
  mediaFiles: MediaFiles;
  mediaLibrary: MediaLibraryService;
}

export function createRouter(services: RouteServices): Router {
  const router = express.Router();

  router.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  router.get('/api/runtime-config', (_request, response) => {
    response.json({ sourceExtensionProfile: services.config.sourceExtensionProfile });
  });

  router.get('/api/categories', (_request, response) => {
    response.json(services.categories.list());
  });

  router.post('/api/categories', (request, response) => {
    const body = z.object({ name: z.string().min(1).max(140) }).parse(request.body);
    response.status(201).json(services.categories.create(body.name));
  });

  router.patch('/api/categories/:id', (request, response) => {
    const body = z.object({ name: z.string().min(1).max(140) }).parse(request.body);
    const category = services.categories.rename(request.params.id, body.name);
    if (!category) {
      response.status(404).json({ error: 'category_not_found' });
      return;
    }
    response.json(category);
  });

  router.delete('/api/categories/:id', (request, response) => {
    const deleted = services.categories.delete(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: 'category_not_found' });
      return;
    }
    response.status(204).end();
  });

  router.get('/api/media', (request, response) => {
    const categoryId = typeof request.query.categoryId === 'string' ? request.query.categoryId : undefined;
    response.json(services.mediaLibrary.list(categoryId));
  });

  router.patch('/api/media/:id', (request, response) => {
    const body = z.object({ title: z.string().min(1).max(140).optional(), categoryId: z.string().uuid().optional() }).parse(request.body);
    let item = services.mediaLibrary.get(request.params.id);
    if (!item) {
      response.status(404).json({ error: 'media_not_found' });
      return;
    }
    if (body.title) {
      item = services.mediaLibrary.rename(item.id, body.title);
    }
    if (body.categoryId) {
      item = services.mediaLibrary.move(item.id, body.categoryId);
    }
    response.json(item);
  });

  router.delete('/api/media/:id', (request, response) => {
    services.mediaLibrary.delete(request.params.id);
    response.status(204).end();
  });

  router.get('/media/:id', (request, response) => {
    const item = services.mediaLibrary.get(request.params.id);
    if (!item) {
      response.status(404).end();
      return;
    }
    streamFile(request, response, services.mediaFiles.absoluteMediaPath(item.relativePath), item.filename);
  });

  router.get('/thumbnails/:id', (request, response) => {
    const item = services.mediaLibrary.get(request.params.id);
    if (!item?.thumbnailPath) {
      response.status(404).end();
      return;
    }
    response.sendFile(services.mediaFiles.absoluteThumbnailPath(item.thumbnailPath));
  });

  router.get('/api/queue', (_request, response) => {
    response.json(services.jobs.snapshot());
  });

  router.get('/extension/shv-source-helper.zip', (request, response) => {
    sendSourceExtensionPackage(request, response, services, sourceExtensionProfile('prod'));
  });

  router.get('/extension/shv-source-helper-dev.zip', (request, response) => {
    sendSourceExtensionPackage(request, response, services, sourceExtensionProfile('dev'));
  });

  function sendSourceExtensionPackage(
    request: Request,
    response: Response,
    services: RouteServices,
    profile: SourceExtensionProfile
  ) {
    const extensionRoot = path.resolve(process.cwd(), 'extension/chrome-source-helper');
    if (!fs.existsSync(extensionRoot)) {
      response.status(404).json({ error: 'extension_artifact_not_found' });
      return;
    }
    const archive = buildZipArchive(
      extensionZipEntries(extensionRoot, profile, appOriginForExtension(request, services.config))
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${profile.packageFilename}"`);
    response.type('zip').send(archive);
  }

  router.post('/api/jobs', (request, response) => {
    const body = z.object({ sourceUrl: z.string().url(), categoryId: z.string().uuid() }).parse(request.body);
    response.status(201).json(services.jobs.create(body.sourceUrl, body.categoryId));
  });

  router.post('/api/jobs/:id/retry', (request, response) => {
    response.json(services.jobs.retry(request.params.id));
  });

  router.post('/api/jobs/:id/cancel', (request, response) => {
    response.json(services.queueRunner.cancel(request.params.id));
  });

  router.delete(
    '/api/jobs/:id',
    asyncRoute(async (request, response) => {
      const jobId = paramId(request);
      await services.liveBrowser.stop(jobId);
      services.queueRunner.delete(jobId);
      response.status(204).end();
    })
  );

  router.get('/api/jobs/:id/candidates', (request, response) => {
    response.json(services.jobs.listCandidates(request.params.id));
  });

  router.post('/api/jobs/:id/extension-candidates', (request, response) => {
    const body = z.object({ candidates: z.array(candidateDraftSchema()).max(200) }).parse(request.body);
    response.json(services.jobs.replaceExtensionCandidates(request.params.id, body.candidates));
  });

  router.post('/api/jobs/:id/cookies', (request, response) => {
    const body = z.object({ cookies: z.array(browserCookieSchema()).max(400) }).parse(request.body);
    if (!services.config.ytDlpCookiesPath) {
      response.status(204).end();
      return;
    }
    fs.mkdirSync(path.dirname(services.config.ytDlpCookiesPath), { recursive: true });
    const existing = readNetscapeCookies(services.config.ytDlpCookiesPath);
    fs.writeFileSync(services.config.ytDlpCookiesPath, browserCookiesToNetscape([...existing, ...body.cookies]));
    response.status(204).end();
  });

  router.post('/api/jobs/:id/select-candidate', (request, response) => {
    const body = z.object({ candidateId: z.string().uuid() }).parse(request.body);
    response.json(services.jobs.selectCandidate(request.params.id, body.candidateId));
  });

  router.post('/api/jobs/:id/replace-source', (request, response) => {
    const body = z.object({ sourceUrl: z.string().url() }).parse(request.body);
    response.json(services.jobs.replaceSource(request.params.id, body.sourceUrl));
  });

  router.get('/api/jobs/:id/screenshot', (request, response) => {
    const screenshotPath = path.join(services.config.appDataRoot, 'manual-screenshots', `${request.params.id}.png`);
    if (!fs.existsSync(screenshotPath)) {
      response.status(404).end();
      return;
    }
    response.sendFile(screenshotPath);
  });

  router.get(
    '/api/jobs/:id/browser',
    asyncRoute(async (request, response) => {
      response.json(await services.liveBrowser.state(paramId(request)));
    })
  );

  router.post(
    '/api/jobs/:id/browser/start',
    asyncRoute(async (request, response) => {
      response.json(await services.liveBrowser.start(paramId(request)));
    })
  );

  router.post(
    '/api/jobs/:id/browser/stop',
    asyncRoute(async (request, response) => {
      await services.liveBrowser.stop(paramId(request));
      response.status(204).end();
    })
  );

  router.get(
    '/api/jobs/:id/browser/screenshot',
    asyncRoute(async (request, response) => {
      const image = await services.liveBrowser.screenshot(paramId(request));
      response.setHeader('Cache-Control', 'no-store');
      response.type('png').send(image);
    })
  );

  router.post(
    '/api/jobs/:id/browser/click',
    asyncRoute(async (request, response) => {
      const body = z.object({ x: z.number().min(0), y: z.number().min(0) }).parse(request.body);
      response.json(await services.liveBrowser.click(paramId(request), body.x, body.y));
    })
  );

  router.post(
    '/api/jobs/:id/browser/scroll',
    asyncRoute(async (request, response) => {
      const body = z.object({ deltaY: z.number().min(-2000).max(2000) }).parse(request.body);
      response.json(await services.liveBrowser.scroll(paramId(request), body.deltaY));
    })
  );

  router.post(
    '/api/jobs/:id/browser/highlight',
    asyncRoute(async (request, response) => {
      const body = z.object({ candidateId: z.string().uuid().nullable() }).parse(request.body);
      response.json(await services.liveBrowser.highlight(paramId(request), body.candidateId));
    })
  );

  return router;
}

function listZipEntries(root: string, prefix: string): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      entries.push({
        data: fs.readFileSync(absolutePath),
        name: path.posix.join(prefix, path.relative(root, absolutePath).split(path.sep).join('/'))
      });
    }
  };
  visit(root);
  return entries;
}

export function extensionZipEntries(
  root: string,
  profile: SourceExtensionProfile,
  appOrigin: string
): ZipEntryInput[] {
  return listZipEntries(root, profile.packagePrefix).map((entry) => {
    if (entry.name === `${profile.packagePrefix}/manifest.json`) {
      const manifest = JSON.parse(entry.data.toString('utf8')) as {
        content_scripts?: Array<{ matches?: string[] }>;
        externally_connectable?: { matches?: string[] };
        host_permissions?: string[];
        key?: string;
        name?: string;
      };
      manifest.name = profile.name;
      manifest.key = profile.key;
      manifest.externally_connectable = {
        ...manifest.externally_connectable,
        matches: uniqueStrings([...(manifest.externally_connectable?.matches ?? []), `${appOrigin}/*`])
      };
      manifest.host_permissions = uniqueStrings([...(manifest.host_permissions ?? []), `${appOrigin}/*`]);
      manifest.content_scripts = manifest.content_scripts?.map((script) => ({
        ...script,
        matches: uniqueStrings([...(script.matches ?? []), `${appOrigin}/*`])
      }));
      return { ...entry, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
    }
    if (entry.name === `${profile.packagePrefix}/shared.js`) {
      const source = entry.data.toString('utf8').replace(
        /^export const APP_ORIGIN = '[^']+';/m,
        `export const APP_ORIGIN = '${appOrigin}';`
      );
      return { ...entry, data: Buffer.from(source) };
    }
    return entry;
  });
}

function appOriginForExtension(request: Request, config: AppConfig): string {
  if (config.publicOrigin) {
    return config.publicOrigin;
  }

  const requestHost = firstHeaderValue(request.get('host'));
  const forwardedHost = firstHeaderValue(request.get('x-forwarded-host'));
  const candidateHosts = new Set([requestHost, forwardedHost].filter(Boolean));
  const refererOrigin = trustedHeaderOrigin(request.get('referer'), candidateHosts);
  if (refererOrigin) {
    return refererOrigin;
  }
  const originHeader = trustedHeaderOrigin(request.get('origin'), candidateHosts);
  if (originHeader) {
    return originHeader;
  }

  const protocol = firstHeaderValue(request.get('x-forwarded-proto')) ?? request.protocol;
  const host = forwardedHost ?? requestHost ?? `127.0.0.1:${config.port}`;
  return normalizeHttpOrigin(`${protocol}://${host}`);
}

function trustedHeaderOrigin(value: string | undefined, trustedHosts: Set<string | undefined>): string | null {
  if (!value) {
    return null;
  }
  try {
    const origin = normalizeHttpOrigin(value);
    const host = new URL(origin).host;
    return trustedHosts.has(host) ? origin : null;
  } catch {
    return null;
  }
}

function normalizeHttpOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('extension app origin must use http or https');
  }
  return parsed.origin;
}

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function candidateDraftSchema(): z.ZodType<CandidateDraft> {
  return z.object({
    bitrate: z.number().nullable(),
    confidence: z.number().min(0).max(1),
    contentType: z.string().nullable(),
    durationSeconds: z.number().nullable(),
    headers: z.record(z.string(), z.string()),
    kind: z.enum(['direct', 'hls', 'dash', 'html-video', 'browser-request']),
    manifestType: z.enum(['hls', 'dash']).nullable(),
    resolution: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    url: z.string().url()
  });
}

function browserCookieSchema() {
  return z.object({
    domain: z.string().min(1).max(255),
    expirationDate: z.number().int().nonnegative().nullable().optional(),
    httpOnly: z.boolean().optional(),
    name: z.string().min(1).max(255),
    path: z.string().min(1).max(2048),
    secure: z.boolean().optional(),
    value: z.string().max(20000)
  });
}

function browserCookiesToNetscape(cookies: z.infer<ReturnType<typeof browserCookieSchema>>[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by shv from an explicit Use source action.'];
  for (const cookie of dedupeBrowserCookies(cookies)) {
    const domain = `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`;
    const includeSubdomains = cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expires = Math.floor(cookie.expirationDate ?? 0);
    lines.push([
      domain,
      includeSubdomains,
      cookie.path,
      secure,
      String(expires),
      cookie.name,
      cookie.value
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

function readNetscapeCookies(filePath: string): z.infer<ReturnType<typeof browserCookieSchema>>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) {
      return [];
    }
    const [rawDomain, _includeSubdomains, cookiePath, secure, expirationDate, name, ...valueParts] = line.split('\t');
    if (!rawDomain || !cookiePath || !name) {
      return [];
    }
    const httpOnly = rawDomain.startsWith('#HttpOnly_');
    const domain = httpOnly ? rawDomain.slice('#HttpOnly_'.length) : rawDomain;
    return [{
      domain,
      expirationDate: Number(expirationDate) || 0,
      httpOnly,
      name,
      path: cookiePath,
      secure: secure === 'TRUE',
      value: valueParts.join('\t')
    }];
  });
}

function dedupeBrowserCookies<T extends { domain: string; name: string; path: string }>(cookies: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const cookie of cookies) {
    byKey.set(`${cookie.domain}\t${cookie.path}\t${cookie.name}`, cookie);
  }
  return [...byKey.values()];
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>): (request: Request, response: Response, next: (error?: unknown) => void) => void {
  return (request, response, next) => {
    handler(request, response).catch(next);
  };
}

function paramId(request: Request): string {
  return String(request.params.id);
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: (error?: unknown) => void): void {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: 'validation_failed', issues: error.issues });
    return;
  }
  if (error instanceof CategoryConflictError) {
    response.status(409).json({ error: error.code, message: error.message });
    return;
  }
  response.status(500).json({ error: 'server_error', message: error instanceof Error ? error.message : String(error) });
}

function streamFile(request: Request, response: Response, filePath: string, filename: string): void {
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  const contentType = mime.lookup(filename) || 'application/octet-stream';
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Disposition', buildContentDisposition(filename));

  if (!range) {
    response.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    response.status(416).end();
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (start >= stat.size || end >= stat.size) {
    response.status(416).end();
    return;
  }

  response.status(206);
  response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  response.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(response);
}

export function buildContentDisposition(filename: string): string {
  const fallback = asciiFilenameFallback(filename);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`;
}

function asciiFilenameFallback(filename: string): string {
  const extension = path.extname(filename).replace(/[^A-Za-z0-9.]/g, '');
  const base = path.basename(filename, path.extname(filename)).replace(/[^\x20-\x7E]/g, '').replace(/["\\;]/g, '').trim();
  return `${base || 'video'}${extension || '.mp4'}`;
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

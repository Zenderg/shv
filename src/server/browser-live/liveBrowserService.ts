import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { MediaCandidate } from '../../shared/types.js';
import type { AppConfig } from '../config/appConfig.js';
import {
  type CandidateDraft,
  classifyMediaUrl,
  extractHtmlMediaCandidates
} from '../candidate-detection/candidateDetection.js';
import type { JobService } from '../jobs/jobService.js';

export interface LiveBrowserState {
  jobId: string;
  running: boolean;
  currentUrl: string | null;
  title: string | null;
  width: number;
  height: number;
  updatedAt: string;
  errorMessage: string | null;
}

interface LiveBrowserSession {
  candidates: Map<string, CandidateDraft>;
  context: BrowserContext;
  errorMessage: string | null;
  jobId: string;
  page: Page;
  updatedAt: string;
}

export class LiveBrowserService {
  private readonly starting = new Map<string, Promise<LiveBrowserState>>();
  private readonly sessions = new Map<string, LiveBrowserSession>();

  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobService
  ) {}

  async start(jobId: string): Promise<LiveBrowserState> {
    const existing = this.sessions.get(jobId);
    if (existing) {
      return this.state(jobId);
    }
    const pending = this.starting.get(jobId);
    if (pending) {
      return pending;
    }

    const starting = this.createSession(jobId).finally(() => {
      this.starting.delete(jobId);
    });
    this.starting.set(jobId, starting);
    return starting;
  }

  private async createSession(jobId: string): Promise<LiveBrowserState> {
    const existing = this.sessions.get(jobId);
    if (existing) {
      return this.state(jobId);
    }

    const job = this.jobs.requireJob(jobId);
    const candidates = new Map<string, CandidateDraft>();
    const profileRoot = path.join(this.config.appDataRoot, 'live-browser-profiles', jobId);
    fs.mkdirSync(profileRoot, { recursive: true });
    const context = await chromium.launchPersistentContext(profileRoot, {
      headless: true,
      ...(this.config.chromiumExecutablePath ? { executablePath: this.config.chromiumExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      viewport: { width: 1366, height: 900 }
    });
    const page = await context.newPage();
    const session: LiveBrowserSession = {
      candidates,
      context,
      errorMessage: null,
      jobId,
      page,
      updatedAt: new Date().toISOString()
    };
    this.sessions.set(jobId, session);

    page.on('response', (response) => {
      const contentType = response.headers()['content-type'] ?? null;
      const detected = classifyMediaUrl(response.url(), contentType);
      if (!detected) {
        return;
      }
      candidates.set(detected.url, {
        ...detected,
        kind: detected.kind === 'direct' ? 'browser-request' : detected.kind,
        headers: browserHeaders(response.request().headers())
      });
      this.flushCandidates(session);
    });

    try {
      await page.goto(job.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1200);
      await this.collectHtmlCandidates(session);
    } catch (error) {
      session.errorMessage = error instanceof Error ? error.message : String(error);
      session.updatedAt = new Date().toISOString();
      this.sessions.delete(jobId);
      await context.close().catch(() => undefined);
      return {
        jobId,
        running: false,
        currentUrl: null,
        title: null,
        width: 1366,
        height: 900,
        updatedAt: session.updatedAt,
        errorMessage: session.errorMessage
      };
    }

    return this.state(jobId);
  }

  async stop(jobId: string): Promise<void> {
    const session = this.sessions.get(jobId);
    if (!session) {
      return;
    }
    this.sessions.delete(jobId);
    await session.context.close().catch(() => undefined);
  }

  async state(jobId: string): Promise<LiveBrowserState> {
    const session = this.sessions.get(jobId);
    if (!session) {
      return {
        jobId,
        running: false,
        currentUrl: null,
        title: null,
        width: 1366,
        height: 900,
        updatedAt: new Date().toISOString(),
        errorMessage: null
      };
    }
    return {
      jobId,
      running: true,
      currentUrl: session.page.url(),
      title: await session.page.title().catch(() => null),
      width: 1366,
      height: 900,
      updatedAt: session.updatedAt,
      errorMessage: session.errorMessage
    };
  }

  async screenshot(jobId: string): Promise<Buffer> {
    const session = await this.requireSession(jobId);
    await this.collectHtmlCandidates(session);
    return session.page.screenshot({ fullPage: false });
  }

  async click(jobId: string, x: number, y: number): Promise<LiveBrowserState> {
    const session = await this.requireSession(jobId);
    await session.page.mouse.click(x, y);
    await session.page.waitForTimeout(900);
    await this.collectHtmlCandidates(session);
    return this.state(jobId);
  }

  async scroll(jobId: string, deltaY: number): Promise<LiveBrowserState> {
    const session = await this.requireSession(jobId);
    await session.page.mouse.wheel(0, deltaY);
    await session.page.waitForTimeout(600);
    await this.collectHtmlCandidates(session);
    return this.state(jobId);
  }

  async highlight(jobId: string, candidateId: string | null): Promise<LiveBrowserState> {
    const session = await this.requireSession(jobId);
    const candidate = candidateId ? this.jobs.listCandidates(jobId).find((item) => item.id === candidateId) ?? null : null;
    await injectHighlight(session.page, candidate?.url ?? null);
    session.updatedAt = new Date().toISOString();
    return this.state(jobId);
  }

  private async requireSession(jobId: string): Promise<LiveBrowserSession> {
    const existing = this.sessions.get(jobId);
    if (existing) {
      return existing;
    }
    await this.start(jobId);
    const session = this.sessions.get(jobId);
    if (!session) {
      throw new Error('Live browser session did not start');
    }
    return session;
  }

  private async collectHtmlCandidates(session: LiveBrowserSession): Promise<void> {
    const html = await session.page.content().catch(() => '');
    if (html) {
      for (const candidate of extractHtmlMediaCandidates(html, session.page.url())) {
        session.candidates.set(candidate.url, candidate);
      }
      this.flushCandidates(session);
    }
  }

  private flushCandidates(session: LiveBrowserSession): void {
    session.updatedAt = new Date().toISOString();
    this.jobs.mergeCandidates(session.jobId, [...session.candidates.values()]);
  }
}

async function injectHighlight(page: Page, candidateUrl: string | null): Promise<void> {
  await page.evaluate(
    `(url) => {
      const overlayId = '__xxx_videos_candidate_highlight__';
      document.getElementById(overlayId)?.remove();
      if (!url) return;
      const candidates = Array.from(document.querySelectorAll('video, source, a, iframe'));
      const exact = candidates.find((element) => {
        const src = element.getAttribute('src') || element.getAttribute('href') || '';
        return src && (src === url || src.includes(url) || url.includes(src));
      });
      const fallback = Array.from(document.querySelectorAll('video, iframe')).find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 80 && rect.height > 60;
      });
      const target = exact || fallback;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.style.position = 'fixed';
      overlay.style.left = Math.max(0, rect.left) + 'px';
      overlay.style.top = Math.max(0, rect.top) + 'px';
      overlay.style.width = Math.max(40, rect.width) + 'px';
      overlay.style.height = Math.max(40, rect.height) + 'px';
      overlay.style.border = '4px solid #22c55e';
      overlay.style.boxShadow = '0 0 0 9999px rgba(34, 197, 94, 0.16), 0 0 24px rgba(34, 197, 94, 0.8)';
      overlay.style.borderRadius = '10px';
      overlay.style.zIndex = '2147483647';
      overlay.style.pointerEvents = 'none';
      document.body.appendChild(overlay);
    }`,
    candidateUrl
  );
}

function browserHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = ['user-agent', 'referer', 'cookie', 'accept', 'accept-language'];
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.includes(key.toLowerCase())));
}

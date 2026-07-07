import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import type { AppConfig } from '../config/appConfig.js';
import {
  type CandidateDraft,
  classifyMediaUrl,
  extractHtmlMediaCandidates,
  isLikelyDirectVideo
} from '../candidate-detection/candidateDetection.js';
import { JobCanceledError, isCancellationError, onAbort, throwIfAborted } from '../utils/cancellation.js';

export interface AnalysisResult {
  candidates: CandidateDraft[];
  titleHint: string | null;
  diagnostics: string[];
  screenshotPath: string | null;
}

export class BrowserAnalyzer {
  constructor(private readonly config: AppConfig) {}

  async analyze(url: string, jobId: string, signal?: AbortSignal): Promise<AnalysisResult> {
    const diagnostics: string[] = [];
    throwIfAborted(signal);
    const direct = await this.detectDirect(url, diagnostics, signal);
    if (direct && direct.confidence >= 0.86) {
      return { candidates: [direct], titleHint: null, diagnostics, screenshotPath: null };
    }

    const candidates = new Map<string, CandidateDraft>();
    if (direct) {
      candidates.set(direct.url, direct);
    }

    let context: BrowserContext | null = null;
    let removeAbortListener: () => void = () => undefined;
    try {
      fs.mkdirSync(this.config.browserDataRoot, { recursive: true });
      context = await chromium.launchPersistentContext(this.config.browserDataRoot, {
        headless: true,
        ...(this.config.chromiumExecutablePath ? { executablePath: this.config.chromiumExecutablePath } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        viewport: { width: 1366, height: 900 }
      });
      removeAbortListener = onAbort(signal, () => {
        void context?.close().catch(() => undefined);
      });
      throwIfAborted(signal);
      const page = await context.newPage();
      page.on('response', (response) => {
        const contentType = response.headers()['content-type'] ?? null;
        const detected = classifyMediaUrl(response.url(), contentType);
        if (detected) {
          candidates.set(detected.url, {
            ...detected,
            kind: detected.kind === 'direct' ? 'browser-request' : detected.kind,
            headers: browserHeaders(response.request().headers())
          });
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      throwIfAborted(signal);
      const html = await page.content();
      for (const candidate of extractHtmlMediaCandidates(html, url)) {
        candidates.set(candidate.url, candidate);
      }

      const titleHint = await page.title().catch(() => null);
      const screenshotPath = path.join(this.config.appDataRoot, 'manual-screenshots', `${jobId}.png`);
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
        diagnostics.push(`Screenshot failed: ${String(error)}`);
      });

      if (candidates.size === 0) {
        diagnostics.push('No media requests, manifests, or HTML media elements were detected.');
      }

      return {
        candidates: [...candidates.values()].sort((left, right) => right.confidence - left.confidence),
        titleHint: titleHint || null,
        diagnostics,
        screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : null
      };
    } catch (error) {
      if (signal?.aborted || isCancellationError(error)) {
        throw new JobCanceledError();
      }
      diagnostics.push(`Browser analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      return { candidates: [...candidates.values()], titleHint: null, diagnostics, screenshotPath: null };
    } finally {
      removeAbortListener();
      await context?.close().catch(() => undefined);
    }
  }

  private async detectDirect(url: string, diagnostics: string[], signal?: AbortSignal): Promise<CandidateDraft | null> {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
      const contentType = response.headers.get('content-type');
      const length = response.headers.get('content-length');
      const detected = classifyMediaUrl(response.url, contentType);
      if (detected) {
        return {
          ...detected,
          sizeBytes: length ? Number(length) : null,
          headers: {}
        };
      }
      if (!isLikelyDirectVideo(url, contentType)) {
        diagnostics.push(`HEAD ${response.status}: ${contentType ?? 'unknown content type'}`);
      }
    } catch (error) {
      if (signal?.aborted || isCancellationError(error)) {
        throw new JobCanceledError();
      }
      diagnostics.push(`HEAD probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return classifyMediaUrl(url);
  }
}

function browserHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = ['user-agent', 'referer', 'cookie', 'accept', 'accept-language'];
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.includes(key.toLowerCase())));
}

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SHOWCASE_CATEGORIES } from './showcaseLibrarySeed.js';

const baseUrl = process.env.SHV_SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:8080';
const outputDir = path.resolve(process.cwd(), 'docs/assets');
const showcaseJobPrefix = 'https://showcase.shv.local/';
const showcaseMediaPrefix = 'showcase-seed://media/';

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const showcaseCategoryIds = new Set<string>();

  await page.route(/\/api\/categories$/, async (route) => {
    const response = await route.fetch();
    const categories = await response.json();
    const filtered = Array.isArray(categories)
      ? categories.filter((category) => SHOWCASE_CATEGORIES.includes(category?.name))
      : [];
    showcaseCategoryIds.clear();
    for (const category of filtered) {
      showcaseCategoryIds.add(String(category.id));
    }
    await route.fulfill({ response, json: filtered });
  });

  await page.route(/\/api\/media(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const media = await response.json();
    const categoryId = new URL(route.request().url()).searchParams.get('categoryId');
    const items = categoryId && showcaseCategoryIds.has(categoryId) && Array.isArray(media?.items)
      ? media.items.filter((item) => typeof item?.sourceUrl === 'string' && item.sourceUrl.startsWith(showcaseMediaPrefix))
      : [];
    await route.fulfill({
      response,
      json: { ...media, items, nextCursor: null, total: items.length }
    });
  });

  await page.route(/\/api\/categories\/[^/]+\/labels$/, async (route) => {
    const categoryId = route.request().url().match(/\/api\/categories\/([^/]+)\/labels$/)?.[1] ?? '';
    if (!showcaseCategoryIds.has(categoryId)) {
      await route.fulfill({ json: { items: [], total: 0 }, status: 200 });
      return;
    }
    const mediaResponse = await page.request.get(`${baseUrl}/api/media?categoryId=${encodeURIComponent(categoryId)}&limit=100`);
    const media = await mediaResponse.json();
    const videos = Array.isArray(media?.items)
      ? media.items.filter((item) => typeof item?.sourceUrl === 'string' && item.sourceUrl.startsWith(showcaseMediaPrefix))
      : [];
    const counts = new Map<string, { count: number; name: string }>();
    for (const video of videos) {
      for (const label of Array.isArray(video?.labels) ? video.labels : []) {
        const key = String(label).normalize('NFKC').toLowerCase();
        const current = counts.get(key);
        counts.set(key, { count: (current?.count ?? 0) + 1, name: current?.name ?? String(label) });
      }
    }
    await route.fulfill({
      json: { items: [...counts.values()].sort((left, right) => left.name.localeCompare(right.name)), total: videos.length },
      status: 200
    });
  });

  await page.route(/\/api\/queue$/, async (route) => {
    const response = await route.fetch();
    const queue = await response.json();
    const jobs = Array.isArray(queue?.jobs)
      ? queue.jobs.filter((job: { sourceUrl?: unknown }) => typeof job.sourceUrl === 'string' && job.sourceUrl.startsWith(showcaseJobPrefix))
      : [];
    const visibleJobIds = new Set(jobs.map((job: { id: string }) => job.id));
    const candidatesByJobId = Object.fromEntries(
      Object.entries(queue?.candidatesByJobId ?? {}).filter(([jobId]) => visibleJobIds.has(jobId))
    );
    await route.fulfill({ response, json: { ...queue, jobs, candidatesByJobId } });
  });

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.warn(`[browser:${message.type()}] ${message.text()}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Japan: 2 videos/ }).waitFor();
  await page.screenshot({ path: path.join(outputDir, 'shv-library.png') });

  await page.getByRole('button', { name: 'Add' }).click();
  await page.screenshot({ path: path.join(outputDir, 'shv-add-video.png') });

  await page.locator('.formDialog header button').click();
  await page.locator('.dialogBackdrop').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Queue/ }).click();
  await page.screenshot({ path: path.join(outputDir, 'shv-queue.png') });

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.SHV_SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:8080';
const outputDir = path.resolve(process.cwd(), 'docs/assets');
const showcaseJobPrefix = 'https://showcase.shv.local/';
const showcaseMediaPrefix = 'showcase-seed://media/';

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.route(/\/api\/media(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const media = await response.json();
    await route.fulfill({
      response,
      json: Array.isArray(media)
        ? media.filter((item) => typeof item?.sourceUrl === 'string' && item.sourceUrl.startsWith(showcaseMediaPrefix))
        : media
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

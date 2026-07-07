import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import type { Category, DownloadJob, MediaItem } from '../src/shared/types.js';
import { CategoryService } from '../src/server/categories/categoryService.js';
import type { AppConfig } from '../src/server/config/appConfig.js';
import { MediaFiles } from '../src/server/media-library/mediaFiles.js';
import { MediaLibraryService } from '../src/server/media-library/mediaLibraryService.js';
import { openDatabase, type Db } from '../src/server/storage/database.js';

const SHOWCASE_MEDIA_PREFIX = 'showcase-seed://media/';
const SHOWCASE_JOB_PREFIX = 'https://showcase.shv.local/';
const PLACEHOLDER_VIDEO = Buffer.from('shv showcase placeholder video\n', 'utf8');

const SHOWCASE_CATEGORIES = [
  'Cinematic Travel',
  'Color Studies',
  'Creative Briefs',
  'Design References',
  'Editing Notes',
  'Event Recaps',
  'Family Archive',
  'Field Research',
  'Home Projects',
  'Music Sessions',
  'Product Demos',
  'Research Clips',
  'Screen Tests',
  'Studio Sessions',
  'Team Reviews',
  'Technical Demos',
  'Template Reviews',
  'Workshop Tutorials'
];

interface ShowcaseVideo {
  audioCodec: string | null;
  categoryName: string;
  container: string;
  durationSeconds: number | null;
  height: number;
  sizeBytes: number;
  title: string;
  videoCodec: string | null;
  width: number;
}

const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  video('Cinematic Travel', 'Tokyo Night Market Walkthrough', 965, 3840, 2160, 1_240_000_000, 'mp4', 'h264', 'aac'),
  video('Cinematic Travel', 'Lisbon Tram Ride, Golden Hour', 742, 1920, 1080, 612_000_000, 'mp4', 'h264', 'aac'),
  video('Cinematic Travel', 'Iceland Ring Road Drone Notes', 1204, 3840, 2160, 1_860_000_000, 'mov', 'h264', 'aac'),
  video('Cinematic Travel', 'Kyoto Alley Ambient Capture', 521, 1920, 1080, 438_000_000, 'mp4', 'h264', 'aac'),
  video('Cinematic Travel', 'Coastal Train Window Study', 688, 2560, 1440, 710_000_000, 'webm', 'vp9', 'opus'),
  video('Color Studies', 'Warm Grade Comparison Reel', 214, 1920, 1080, 186_000_000, 'mp4', 'h264', 'aac'),
  video('Color Studies', 'Low Light Palette Tests', 278, 1920, 1080, 226_000_000, 'mp4', 'h264', 'aac'),
  video('Creative Briefs', 'Launch Concept Moodboard', 246, 1920, 1080, 205_000_000, 'mp4', 'h264', 'aac'),
  video('Creative Briefs', 'Campaign Storyboard Review', 391, 1920, 1080, 326_000_000, 'mp4', 'h264', 'aac'),
  video('Design References', 'Dashboard Motion Reference Reel', 338, 1920, 1080, 294_000_000, 'mp4', 'h264', 'aac'),
  video('Design References', 'Checkout Flow Usability Review', 485, 1920, 1080, 351_000_000, 'mp4', 'h264', 'aac'),
  video('Design References', 'Typography System Critique', 412, 2560, 1440, 502_000_000, 'webm', 'vp9', 'opus'),
  video('Design References', 'Mobile Navigation Patterns', 269, 1080, 1920, 230_000_000, 'mp4', 'h264', 'aac'),
  video('Editing Notes', 'Rough Cut Review Session', 581, 1920, 1080, 472_000_000, 'mp4', 'h264', 'aac'),
  video('Editing Notes', 'Final Export Checklist', 193, 1920, 1080, 142_000_000, 'mp4', 'h264', 'aac'),
  video('Event Recaps', 'Community Meetup Highlights', 429, 1920, 1080, 338_000_000, 'mp4', 'h264', 'aac'),
  video('Event Recaps', 'Panel Q&A Selects', 714, 1920, 1080, 544_000_000, 'mp4', 'h264', 'aac'),
  video('Family Archive', 'Summer Lake Weekend 2025', 812, 1920, 1080, 588_000_000, 'mp4', 'h264', 'aac'),
  video('Family Archive', 'Garden Birthday Highlights', 455, 1920, 1080, 318_000_000, 'mp4', 'h264', 'aac'),
  video('Family Archive', 'Old VHS Cleanup Preview', null, 720, 576, 96_000_000, 'mp4', null, 'aac'),
  video('Field Research', 'Museum Exhibit Walkthrough', 633, 1920, 1080, 456_000_000, 'mp4', 'h264', 'aac'),
  video('Field Research', 'Street Interview B-Roll Selects', 508, 1920, 1080, 386_000_000, 'mov', 'h264', 'aac'),
  video('Field Research', 'Conference Hall Sound Test', 274, 1280, 720, 122_000_000, 'webm', 'vp9', 'opus'),
  video('Home Projects', 'Cabin Shelving Timelapse', 711, 1920, 1080, 518_000_000, 'mp4', 'h264', 'aac'),
  video('Home Projects', 'Workshop Lighting Before After', 389, 1920, 1080, 276_000_000, 'mp4', 'h264', 'aac'),
  video('Home Projects', 'Kitchen Garden Irrigation Notes', 604, 1920, 1080, 422_000_000, 'mp4', 'h264', 'aac'),
  video('Music Sessions', 'Live Room Guitar Take 03', 326, 1920, 1080, 275_000_000, 'mp4', 'h264', 'aac'),
  video('Music Sessions', 'Piano Arrangement Draft', 514, 1920, 1080, 401_000_000, 'mov', 'h264', 'aac'),
  video('Music Sessions', 'Studio Drum Mic Comparison', 448, 1920, 1080, 358_000_000, 'webm', 'vp9', 'opus'),
  video('Product Demos', 'Offline Library Browsing Tour', 296, 1920, 1080, 244_000_000, 'mp4', 'h264', 'aac'),
  video('Product Demos', 'Manual Source Selection Flow', 362, 1920, 1080, 312_000_000, 'mp4', 'h264', 'aac'),
  video('Product Demos', 'Large Archive Stress Preview', 238, 2560, 1440, 421_000_000, 'webm', 'vp9', 'opus'),
  video('Research Clips', 'Annotated Source Review', 352, 1920, 1080, 268_000_000, 'mp4', 'h264', 'aac'),
  video('Screen Tests', 'Portrait Capture Framing', 267, 1080, 1920, 218_000_000, 'mp4', 'h264', 'aac'),
  video('Studio Sessions', 'Podcast Camera Angle Pass', 466, 1920, 1080, 375_000_000, 'mp4', 'h264', 'aac'),
  video('Team Reviews', 'Weekly Demo Recording', 603, 1920, 1080, 446_000_000, 'mp4', 'h264', 'aac'),
  video('Technical Demos', 'HLS Manifest Capture Notes', 319, 1920, 1080, 264_000_000, 'mp4', 'h264', 'aac'),
  video('Template Reviews', 'Reusable Intro Sequence', 221, 1920, 1080, 179_000_000, 'mp4', 'h264', 'aac'),
  video('Workshop Tutorials', 'Restoring a Download After Failure', 675, 1920, 1080, 488_000_000, 'mp4', 'h264', 'aac'),
  video('Workshop Tutorials', 'Organizing Categories for a Home LAN', 532, 1920, 1080, 394_000_000, 'mp4', 'h264', 'aac'),
  video('Workshop Tutorials', 'Browser Extension Capture Demo', 447, 1920, 1080, 352_000_000, 'mp4', 'h264', 'aac')
];

export interface ShowcaseSeedResult {
  categories: Category[];
  jobs: DownloadJob[];
  media: MediaItem[];
}

export interface ShowcaseResetResult {
  deletedCategories: number;
  deletedFiles: number;
  deletedJobs: number;
  deletedMedia: number;
  deletedThumbnails: number;
}

export function seedShowcaseLibrary(root = process.cwd()): ShowcaseSeedResult {
  const services = createServices(root);
  const categories = new Map<string, Category>();
  const media: MediaItem[] = [];

  for (const name of SHOWCASE_CATEGORIES) {
    categories.set(name, services.categories.create(name));
  }

  SHOWCASE_VIDEOS.forEach((item, index) => {
    const category = categories.get(item.categoryName);
    if (!category) {
      throw new Error(`Unknown showcase category "${item.categoryName}".`);
    }
    const finalFilePath = services.mediaFiles.finalVideoPath(category, `${item.title}.mp4`);
    fs.writeFileSync(finalFilePath, PLACEHOLDER_VIDEO);
    const thumbnailPath = writeThumbnail(services.config, item, index);

    media.push(
      services.mediaLibrary.create({
        audioCodec: item.audioCodec,
        categoryId: category.id,
        container: item.container,
        durationSeconds: item.durationSeconds,
        finalFilePath,
        height: item.height,
        sizeBytes: item.sizeBytes,
        sourceUrl: `${SHOWCASE_MEDIA_PREFIX}${slug(item.categoryName)}/${slug(item.title)}`,
        thumbnailPath,
        title: item.title,
        videoCodec: item.videoCodec,
        width: item.width
      })
    );
  });

  const jobs = seedShowcaseJobs(services.db, categories);
  closeDb(services.db);
  return { categories: Array.from(categories.values()), jobs, media };
}

export function resetShowcaseLibrary(root = process.cwd()): ShowcaseResetResult {
  const services = createServices(root);
  const mediaRows = services.db
    .prepare(
      `SELECT id, category_id, relative_path, thumbnail_path
       FROM media_items
       WHERE source_url LIKE ?`
    )
    .all(`${SHOWCASE_MEDIA_PREFIX}%`)
    .map((row) => mapSeedMediaRow(row as Record<string, unknown>));

  let deletedFiles = 0;
  let deletedThumbnails = 0;
  for (const row of mediaRows) {
    deletedFiles += deleteIfExists(services.mediaFiles.absoluteMediaPath(row.relativePath));
    if (row.thumbnailPath) {
      deletedThumbnails += deleteIfExists(services.mediaFiles.absoluteThumbnailPath(row.thumbnailPath));
    }
  }

  services.db.prepare(`DELETE FROM media_items WHERE source_url LIKE ?`).run(`${SHOWCASE_MEDIA_PREFIX}%`);
  services.db.prepare(`DELETE FROM media_candidates WHERE job_id IN (SELECT id FROM download_jobs WHERE source_url LIKE ?)`).run(`${SHOWCASE_JOB_PREFIX}%`);
  const deletedJobs = Number(services.db.prepare(`DELETE FROM download_jobs WHERE source_url LIKE ?`).run(`${SHOWCASE_JOB_PREFIX}%`).changes ?? 0);

  let deletedCategories = 0;
  for (const category of services.categories.list().filter((item) => SHOWCASE_CATEGORIES.includes(item.name))) {
    const mediaCount = rowCount(services.db.prepare('SELECT COUNT(*) AS count FROM media_items WHERE category_id = ?').get(category.id));
    const jobCount = rowCount(services.db.prepare("SELECT COUNT(*) AS count FROM download_jobs WHERE category_id = ? AND status != 'completed'").get(category.id));
    if (mediaCount === 0 && jobCount === 0 && services.categories.delete(category.id)) {
      deletedCategories += 1;
    }
  }

  closeDb(services.db);
  return {
    deletedCategories,
    deletedFiles,
    deletedJobs,
    deletedMedia: mediaRows.length,
    deletedThumbnails
  };
}

interface ShowcaseServices {
  categories: CategoryService;
  config: AppConfig;
  db: Db;
  mediaFiles: MediaFiles;
  mediaLibrary: MediaLibraryService;
}

function createServices(root: string): ShowcaseServices {
  const config = localDataConfig(root);
  fs.mkdirSync(config.libraryRoot, { recursive: true });
  fs.mkdirSync(config.appDataRoot, { recursive: true });
  fs.mkdirSync(config.thumbnailsRoot, { recursive: true });
  fs.mkdirSync(config.workRoot, { recursive: true });

  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
  categories.ensureDefaultCategory();
  const mediaFiles = new MediaFiles(config, categories);
  const mediaLibrary = new MediaLibraryService(db, categories, mediaFiles);
  return { categories, config, db, mediaFiles, mediaLibrary };
}

function localDataConfig(root: string): AppConfig {
  const appDataRoot = path.join(root, 'data', 'app');
  return {
    appDataRoot,
    browserDataRoot: path.join(appDataRoot, 'browser'),
    chromiumExecutablePath: undefined,
    databasePath: path.join(appDataRoot, 'shv.sqlite'),
    host: '127.0.0.1',
    libraryRoot: path.join(root, 'data', 'library'),
    port: 0,
    sourceExtensionProfile: 'prod',
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'data', 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'youtube-cookies.txt')
  };
}

function seedShowcaseJobs(db: Db, categories: Map<string, Category>): DownloadJob[] {
  const now = new Date().toISOString();
  const jobs = [
    {
      categoryName: 'Product Demos',
      errorCode: 'manual_selection_required',
      errorMessage: 'Choose one of the detected video streams to continue.',
      progress: 0.2,
      sourceUrl: `${SHOWCASE_JOB_PREFIX}manual-source-selection`,
      status: 'needs_manual_selection',
      titleHint: 'Manual Source Selection Flow'
    },
    {
      categoryName: 'Workshop Tutorials',
      errorCode: 'network_interrupted',
      errorMessage: 'The source stopped responding during download. Retry when the network is stable.',
      progress: 0.44,
      sourceUrl: `${SHOWCASE_JOB_PREFIX}restore-after-failure`,
      status: 'failed',
      titleHint: 'Restoring a Download After Failure'
    },
    {
      categoryName: 'Field Research',
      errorCode: null,
      errorMessage: null,
      progress: 0,
      sourceUrl: `${SHOWCASE_JOB_PREFIX}old-field-capture`,
      status: 'canceled',
      titleHint: 'Old Field Capture'
    }
  ] as const;

  return jobs.map((job) => {
    const category = categories.get(job.categoryName);
    if (!category) {
      throw new Error(`Unknown showcase category "${job.categoryName}".`);
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO download_jobs (
        id, source_url, category_id, status, selected_candidate_id, title_hint, error_code,
        error_message, progress, created_at, updated_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      job.sourceUrl,
      category.id,
      job.status,
      null,
      job.titleHint,
      job.errorCode,
      job.errorMessage,
      job.progress,
      now,
      now,
      now,
      job.status === 'failed' || job.status === 'canceled' ? now : null
    );

    if (job.status === 'needs_manual_selection') {
      seedCandidates(db, id, now);
    }

    return {
      categoryId: category.id,
      completedAt: job.status === 'failed' || job.status === 'canceled' ? now : null,
      createdAt: now,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      id,
      progress: job.progress,
      selectedCandidateId: null,
      sourceUrl: job.sourceUrl,
      startedAt: now,
      status: job.status,
      titleHint: job.titleHint,
      updatedAt: now
    };
  });
}

function seedCandidates(db: Db, jobId: string, now: string): void {
  const rows = [
    ['browser-request', 'https://cdn.showcase.shv.local/manual-source-1080p.mp4', 'video/mp4', null, '1920x1080', 5_800_000, 362, 312_000_000, 0.91],
    ['hls', 'https://cdn.showcase.shv.local/manual-source/index.m3u8', 'application/vnd.apple.mpegurl', 'hls', '1280x720', 3_400_000, 362, null, 0.82]
  ] as const;

  for (const row of rows) {
    db.prepare(
      `INSERT INTO media_candidates (
        id, job_id, kind, url, content_type, manifest_type, resolution, bitrate,
        duration_seconds, size_bytes, confidence, headers_json, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), jobId, ...row, '{}', now);
  }
}

function video(
  categoryName: string,
  title: string,
  durationSeconds: number | null,
  width: number,
  height: number,
  sizeBytes: number,
  container: string,
  videoCodec: string | null,
  audioCodec: string | null
): ShowcaseVideo {
  return { audioCodec, categoryName, container, durationSeconds, height, sizeBytes, title, videoCodec, width };
}

function writeThumbnail(config: AppConfig, item: ShowcaseVideo, index: number): string {
  fs.mkdirSync(config.thumbnailsRoot, { recursive: true });
  const thumbnailPath = path.join(config.thumbnailsRoot, `showcase-${String(index + 1).padStart(2, '0')}-${slug(item.title)}.svg`);
  fs.writeFileSync(thumbnailPath, thumbnailSvg(item, index));
  return thumbnailPath;
}

function thumbnailSvg(item: ShowcaseVideo, index: number): string {
  const palettes = [
    ['#12342f', '#6ccf91', '#e8f6e9'],
    ['#1f2435', '#86b7ff', '#f3f7ff'],
    ['#322217', '#f1b66a', '#fff2dd'],
    ['#1b2b34', '#63d4c7', '#ecfffb'],
    ['#2a1d35', '#c9a6ff', '#fbf6ff'],
    ['#14301f', '#b4df72', '#f8ffe9']
  ];
  const [start, accent, text] = palettes[index % palettes.length];
  const label = escapeXml(item.categoryName.toUpperCase());
  const title = escapeXml(item.title);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${start}"/>
      <stop offset="1" stop-color="#09100d"/>
    </linearGradient>
    <radialGradient id="glow" cx="26%" cy="24%" r="58%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <path d="M120 520 C260 430 395 585 565 496 C735 407 844 301 1160 364 L1160 720 L120 720 Z" fill="${accent}" opacity="0.2"/>
  <circle cx="1064" cy="148" r="76" fill="${accent}" opacity="0.2"/>
  <text x="96" y="116" fill="${accent}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="4">${label}</text>
  <text x="96" y="582" fill="${text}" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="850">${title}</text>
</svg>`;
}

function mapSeedMediaRow(row: Record<string, unknown>) {
  return {
    categoryId: String(row.category_id),
    id: String(row.id),
    relativePath: String(row.relative_path),
    thumbnailPath: row.thumbnail_path === null ? null : String(row.thumbnail_path)
  };
}

function deleteIfExists(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  fs.rmSync(filePath, { force: true });
  return 1;
}

function rowCount(row: unknown): number {
  return Number((row as { count?: number | string } | undefined)?.count ?? 0);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function closeDb(db: Db): void {
  const closable = db as Db & { close?: () => void };
  closable.close?.();
}

function runCli(): void {
  const command = process.argv[2] ?? 'seed';
  if (command === 'reset') {
    const result = resetShowcaseLibrary();
    console.log(
      `Deleted ${result.deletedMedia} showcase media, ${result.deletedJobs} jobs, ${result.deletedCategories} categories, ${result.deletedFiles} files, ${result.deletedThumbnails} thumbnails.`
    );
    return;
  }
  if (command !== 'seed') {
    throw new Error(`Unknown command "${command}". Use "seed" or "reset".`);
  }

  const result = seedShowcaseLibrary();
  console.log(`Created ${result.media.length} showcase media, ${result.jobs.length} jobs across ${result.categories.length} categories.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

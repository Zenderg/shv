import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, MediaItem } from '../src/shared/types.js';
import { CategoryService } from '../src/server/categories/categoryService.js';
import type { AppConfig } from '../src/server/config/appConfig.js';
import { MediaFiles } from '../src/server/media-library/mediaFiles.js';
import { MediaLibraryService } from '../src/server/media-library/mediaLibraryService.js';
import { openDatabase, type Db } from '../src/server/storage/database.js';

const DEV_CATEGORY_PREFIX = '[dev] ';
const DEV_SOURCE_PREFIX = 'dev-seed://';
const DEFAULT_CATEGORY_COUNT = 12;
const DEFAULT_VIDEO_COUNT = 180;
const PLACEHOLDER_VIDEO = Buffer.from('shv dev seed placeholder video\n', 'utf8');
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AT//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AT//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QP//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QP//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QP//Z',
  'base64'
);

export interface DevLibrarySeedOptions {
  categoryCount?: number;
  root?: string;
  videoCount?: number;
}

export interface DevLibrarySeedResult {
  categories: Category[];
  media: MediaItem[];
}

export interface DevLibraryResetResult {
  deletedCategories: number;
  deletedFiles: number;
  deletedMedia: number;
  deletedThumbnails: number;
}

export function seedDevLibrary(options: DevLibrarySeedOptions = {}): DevLibrarySeedResult {
  const categoryCount = positiveInteger(options.categoryCount, DEFAULT_CATEGORY_COUNT);
  const videoCount = positiveInteger(options.videoCount, DEFAULT_VIDEO_COUNT);
  const services = createServices(options.root);
  const categories = createDevCategories(services.categories, categoryCount);
  const media: MediaItem[] = [];

  for (let index = 0; index < videoCount; index += 1) {
    const category = categories[index % categories.length];
    const title = videoTitle(index);
    const filename = `${title}.mp4`;
    const finalFilePath = services.mediaFiles.finalVideoPath(category, filename);
    fs.writeFileSync(finalFilePath, PLACEHOLDER_VIDEO);
    const thumbnailPath = index % 4 === 0 ? writeThumbnail(services.config, index) : null;

    media.push(
      services.mediaLibrary.create({
        audioCodec: index % 5 === 0 ? null : ['aac', 'opus', 'mp3'][index % 3],
        categoryId: category.id,
        container: ['mp4', 'webm', 'mov'][index % 3],
        durationSeconds: index % 7 === 0 ? null : 15 + index * 9,
        finalFilePath,
        height: [240, 360, 720, 1080, 2160][index % 5],
        sizeBytes: Math.max(fs.statSync(finalFilePath).size, 1024 + index * 4096),
        sourceUrl: `${DEV_SOURCE_PREFIX}media/${Date.now()}-${index}`,
        thumbnailPath,
        title,
        videoCodec: index % 6 === 0 ? null : ['h264', 'vp9', 'av1'][index % 3],
        width: [426, 640, 1280, 1920, 3840][index % 5]
      })
    );
  }

  closeDb(services.db);
  return { categories, media };
}

export function resetDevLibrary(options: Pick<DevLibrarySeedOptions, 'root'> = {}): DevLibraryResetResult {
  const services = createServices(options.root);
  const mediaRows = services.db
    .prepare(
      `SELECT id, relative_path, thumbnail_path
       FROM media_items
       WHERE source_url LIKE ?`
    )
    .all(`${DEV_SOURCE_PREFIX}%`)
    .map((row) => mapSeedMediaRow(row as Record<string, unknown>));

  let deletedFiles = 0;
  let deletedThumbnails = 0;
  for (const row of mediaRows) {
    deletedFiles += deleteIfExists(services.mediaFiles.absoluteMediaPath(row.relativePath));
    if (row.thumbnailPath) {
      deletedThumbnails += deleteIfExists(services.mediaFiles.absoluteThumbnailPath(row.thumbnailPath));
    }
  }

  services.db.prepare(`DELETE FROM media_items WHERE source_url LIKE ?`).run(`${DEV_SOURCE_PREFIX}%`);

  let deletedCategories = 0;
  for (const category of services.categories.list().filter((item) => item.name.startsWith(DEV_CATEGORY_PREFIX))) {
    const mediaCount = Number(
      (
        services.db
          .prepare('SELECT COUNT(*) AS count FROM media_items WHERE category_id = ?')
          .get(category.id) as { count?: number | string } | undefined
      )?.count ?? 0
    );
    if (mediaCount === 0 && services.categories.delete(category.id)) {
      deletedCategories += 1;
    }
  }

  closeDb(services.db);
  return {
    deletedCategories,
    deletedFiles,
    deletedMedia: mediaRows.length,
    deletedThumbnails
  };
}

interface DevLibraryServices {
  categories: CategoryService;
  config: AppConfig;
  db: Db;
  mediaFiles: MediaFiles;
  mediaLibrary: MediaLibraryService;
}

function createServices(root = process.cwd()): DevLibraryServices {
  const config = localDataConfig(root);
  fs.mkdirSync(config.libraryRoot, { recursive: true });
  fs.mkdirSync(config.appDataRoot, { recursive: true });
  fs.mkdirSync(config.thumbnailsRoot, { recursive: true });
  fs.mkdirSync(config.workRoot, { recursive: true });

  const db = openDatabase(config.databasePath);
  const categories = new CategoryService(db, config);
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
    thumbnailsRoot: path.join(appDataRoot, 'thumbnails'),
    workRoot: path.join(root, 'data', 'work'),
    ytDlpCookiesPath: path.join(appDataRoot, 'youtube-cookies.txt')
  };
}

function createDevCategories(categories: CategoryService, count: number): Category[] {
  return Array.from({ length: count }, (_value, index) => categories.create(categoryName(index)));
}

function categoryName(index: number): string {
  const names = [
    'Overflow Grid',
    'Very long category name for wrapping and navigation pressure',
    'Unicode - Превью Коллекция',
    'Tiny',
    'Mixed Aspect Ratios',
    'No Thumbnails',
    'Archive 2020-2026',
    'Symbols !@#$ percent',
    'One Item Eventually',
    'Lots Of Items',
    'Mobile Stress',
    'Renames And Moves'
  ];
  return `${DEV_CATEGORY_PREFIX}${names[index % names.length]} ${Math.floor(index / names.length) + 1}`;
}

function videoTitle(index: number): string {
  const titles = [
    'Short clip',
    'A very very long video title that should wrap without breaking card controls',
    'Unicode title Пример видео',
    'Square-ish source',
    'Portrait phone capture',
    'No thumbnail placeholder',
    'Tiny metadata',
    'Huge fake file',
    'Symbols !@#$ percent',
    'Repeatable list item'
  ];
  return `[dev] ${titles[index % titles.length]} ${String(index + 1).padStart(3, '0')}`;
}

function writeThumbnail(config: AppConfig, index: number): string {
  fs.mkdirSync(config.thumbnailsRoot, { recursive: true });
  const thumbnailPath = path.join(config.thumbnailsRoot, `dev-seed-${Date.now()}-${index}.jpg`);
  fs.writeFileSync(thumbnailPath, PLACEHOLDER_JPEG);
  return thumbnailPath;
}

interface SeedMediaRow {
  id: string;
  relativePath: string;
  thumbnailPath: string | null;
}

function mapSeedMediaRow(row: Record<string, unknown>): SeedMediaRow {
  return {
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

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function closeDb(db: Db): void {
  const closable = db as Db & { close?: () => void };
  closable.close?.();
}

function parseCliArgs(args: string[]): { command: 'seed' | 'reset'; options: DevLibrarySeedOptions } {
  const [command = 'seed', ...rest] = args;
  if (command !== 'seed' && command !== 'reset') {
    throw new Error(`Unknown command "${command}". Use "seed" or "reset".`);
  }

  const options: DevLibrarySeedOptions = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--categories') {
      options.categoryCount = parsePositiveCliInteger(rest[index + 1], '--categories');
      index += 1;
    } else if (arg === '--videos') {
      options.videoCount = parsePositiveCliInteger(rest[index + 1], '--videos');
      index += 1;
    } else {
      throw new Error(`Unknown option "${arg}".`);
    }
  }

  return { command, options };
}

function parsePositiveCliInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function runCli(): void {
  const { command, options } = parseCliArgs(process.argv.slice(2));
  if (command === 'reset') {
    const result = resetDevLibrary(options);
    console.log(
      `Deleted ${result.deletedMedia} dev media, ${result.deletedCategories} dev categories, ${result.deletedFiles} files, ${result.deletedThumbnails} thumbnails.`
    );
    return;
  }

  const result = seedDevLibrary(options);
  console.log(`Created ${result.media.length} dev media across ${result.categories.length} dev categories.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

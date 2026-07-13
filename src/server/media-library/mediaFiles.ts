import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/appConfig.js';
import { assertInsideRoot, sanitizeName, uniquePath } from '../utils/fileSafety.js';
import type { CategoryService } from '../categories/categoryService.js';
import type { Category } from '../../shared/types.js';

export interface ReservedVideoPath {
  path: string;
  release(): void;
}

export class MediaFiles {
  private readonly reservedVideoPaths = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly categories: CategoryService
  ) {}

  finalVideoPath(category: Category, desiredFilename: string): string {
    const categoryPath = this.categories.categoryPath(category);
    return uniquePath(categoryPath, sanitizeName(desiredFilename, 'video.mp4'));
  }

  reserveFinalVideoPath(category: Category, desiredFilename: string): ReservedVideoPath {
    const categoryPath = this.categories.categoryPath(category);
    const path = uniquePath(categoryPath, sanitizeName(desiredFilename, 'video.mp4'), this.reservedVideoPaths);
    this.reservedVideoPaths.add(path);
    let released = false;
    return {
      path,
      release: () => {
        if (!released) {
          this.reservedVideoPaths.delete(path);
          released = true;
        }
      }
    };
  }

  absoluteMediaPath(relativePath: string): string {
    return assertInsideRoot(this.config.libraryRoot, path.join(this.config.libraryRoot, relativePath));
  }

  relativeMediaPath(absolutePath: string): string {
    return path.relative(this.config.libraryRoot, assertInsideRoot(this.config.libraryRoot, absolutePath));
  }

  thumbnailPath(id: string, extension = '.jpg'): string {
    fs.mkdirSync(this.config.thumbnailsRoot, { recursive: true });
    return assertInsideRoot(this.config.thumbnailsRoot, path.join(this.config.thumbnailsRoot, `${id}${extension}`));
  }

  relativeThumbnailPath(absolutePath: string): string {
    return path.relative(this.config.appDataRoot, assertInsideRoot(this.config.appDataRoot, absolutePath));
  }

  absoluteThumbnailPath(relativePath: string): string {
    return assertInsideRoot(this.config.appDataRoot, path.join(this.config.appDataRoot, relativePath));
  }
}

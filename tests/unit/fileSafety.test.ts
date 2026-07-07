import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { assertInsideRoot, sanitizeName, uniquePath } from '../../src/server/utils/fileSafety.js';

describe('fileSafety', () => {
  test('sanitizes unsafe filesystem names without losing readable text', () => {
    expect(sanitizeName('  Cats: <one>? * / video.mp4  ')).toBe('Cats one video.mp4');
    expect(sanitizeName('CON')).toBe('CON-item');
    expect(sanitizeName('...')).toBe('untitled');
  });

  test('rejects paths outside the configured root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-root-'));
    expect(assertInsideRoot(root, path.join(root, 'ok.mp4'))).toBe(path.join(root, 'ok.mp4'));
    expect(() => assertInsideRoot(root, path.join(root, '..', 'escape.mp4'))).toThrow(/escapes/);
  });

  test('allocates stable suffixes when a filename already exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-unique-'));
    fs.writeFileSync(path.join(root, 'video.mp4'), '');
    fs.writeFileSync(path.join(root, 'video-2.mp4'), '');
    expect(uniquePath(root, 'video.mp4')).toBe(path.join(root, 'video-3.mp4'));
  });
});

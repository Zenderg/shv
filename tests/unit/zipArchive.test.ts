import { describe, expect, test } from 'vitest';
import { buildZipArchive } from '../../src/server/utils/zipArchive.js';

describe('zip archive builder', () => {
  test('creates a zip file containing stored file entries', () => {
    const archive = buildZipArchive([
      { data: Buffer.from('hello'), name: 'extension/manifest.json' },
      { data: Buffer.from('world'), name: 'extension/service-worker.js' }
    ]);

    expect(archive.subarray(0, 4).toString('binary')).toBe('PK\u0003\u0004');
    expect(archive.includes(Buffer.from('extension/manifest.json'))).toBe(true);
    expect(archive.includes(Buffer.from('extension/service-worker.js'))).toBe(true);
    expect(archive.includes(Buffer.from('PK\u0005\u0006', 'binary'))).toBe(true);
  });
});

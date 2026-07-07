import { describe, expect, test } from 'vitest';
import { buildContentDisposition } from '../../src/server/api/routes.js';

describe('stream headers', () => {
  test('builds a valid content disposition for unicode filenames', () => {
    const header = buildContentDisposition('Йога для начинающих – проба.mp4');

    expect(header).toContain('inline;');
    expect(header).toContain('filename="video.mp4"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('%D0%99%D0%BE%D0%B3%D0%B0');
    expect(() => new Headers({ 'Content-Disposition': header })).not.toThrow();
  });
});

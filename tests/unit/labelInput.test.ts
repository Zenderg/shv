import { describe, expect, test } from 'vitest';
import { normalizeLabelValues } from '../../src/web/src/features/labels/LabelInput.js';

describe('label input normalization', () => {
  test('collapses whitespace, normalizes Unicode, and deduplicates case-insensitively', () => {
    expect(normalizeLabelValues(['  Studio   A ', 'studio a', 'Ｓｅｒｉｅｓ'])).toEqual(['Studio A', 'Series']);
  });
});

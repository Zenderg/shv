import { describe, expect, test } from 'vitest';
import {
  libraryColumnCount,
  libraryRowCount,
  libraryRowItems
} from '../../src/web/src/features/library/libraryVirtualization.js';

describe('virtual library layout', () => {
  test('matches responsive one-column and desktop grid breakpoints', () => {
    expect(libraryColumnCount(640, 680)).toBe(1);
    expect(libraryColumnCount(876, 1200)).toBe(3);
    expect(libraryColumnCount(280, 1200)).toBe(1);
  });

  test('groups items into stable virtual rows', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(libraryRowCount(items.length, 2)).toBe(3);
    expect(libraryRowItems(items, 0, 2)).toEqual(['a', 'b']);
    expect(libraryRowItems(items, 2, 2)).toEqual(['e']);
  });
});

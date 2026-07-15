export const LIBRARY_GRID_GAP = 18;
export const LIBRARY_MIN_CARD_WIDTH = 280;
export const LIBRARY_MOBILE_BREAKPOINT = 680;

export function libraryColumnCount(containerWidth: number, viewportWidth: number): number {
  if (containerWidth <= 0 || viewportWidth <= LIBRARY_MOBILE_BREAKPOINT) {
    return 1;
  }
  return Math.max(1, Math.floor(
    (containerWidth + LIBRARY_GRID_GAP) / (LIBRARY_MIN_CARD_WIDTH + LIBRARY_GRID_GAP)
  ));
}

export function libraryRowCount(itemCount: number, columnCount: number): number {
  return Math.ceil(itemCount / Math.max(1, columnCount));
}

export function libraryRowItems<T>(items: readonly T[], rowIndex: number, columnCount: number): readonly T[] {
  const firstIndex = rowIndex * columnCount;
  return items.slice(firstIndex, firstIndex + columnCount);
}

import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { MediaActionsMenu } from '../../components/MediaActionsMenu';
import { PlayIcon } from '../../components/icons';
import type { MediaItem } from '../../lib/api';
import { formatBytes, formatDuration, formatResolution } from '../../utils/format';
import {
  LIBRARY_GRID_GAP,
  libraryColumnCount,
  libraryRowCount,
  libraryRowItems
} from './libraryVirtualization';

interface LibraryGridProps {
  activeLabel: string | null;
  categoryName: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  items: MediaItem[];
  nextPageError: boolean;
  onAdd: () => void;
  onClearLabel: () => void;
  onCreateCategory: () => void;
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onLoadMore: () => void;
  onPlay: (item: MediaItem) => void;
  onSelectLabel: (label: string) => void;
  scrollElementRef: RefObject<HTMLElement | null>;
  total: number;
}

export function LibraryGrid(props: LibraryGridProps) {
  if (props.items.length === 0) {
    return <EmptyLibrary {...props} />;
  }
  return <VirtualLibraryGrid {...props} />;
}

function EmptyLibrary({ activeLabel, categoryName, onAdd, onClearLabel, onCreateCategory }: LibraryGridProps) {
  return (
    <section className="emptyState">
      <PlayIcon />
      <h2>{activeLabel ? `No videos labeled ${activeLabel}` : categoryName ? `No videos in ${categoryName}` : 'Start your library'}</h2>
      <p>
        {activeLabel
          ? 'The label may have changed while this filter was active.'
          : categoryName
          ? 'Add a video link; completed downloads will appear here.'
          : 'Create a category or add a video link to begin your local library.'}
      </p>
      <div className="emptyStateActions">
        {activeLabel ? (
          <button className="primaryButton" onClick={onClearLabel} type="button">Clear filter</button>
        ) : (
          <button className="primaryButton" onClick={onAdd} type="button">
            {categoryName ? 'Add video' : 'Add first video'}
          </button>
        )}
        {!categoryName ? (
          <button className="secondaryButton" onClick={onCreateCategory} type="button">
            Create category
          </button>
        ) : null}
      </div>
    </section>
  );
}

function VirtualLibraryGrid({
  activeLabel,
  hasNextPage,
  isFetchingNextPage,
  items,
  nextPageError,
  onDelete,
  onEdit,
  onLoadMore,
  onPlay,
  onSelectLabel,
  scrollElementRef,
  total
}: LibraryGridProps) {
  const containerRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [scrollMargin, setScrollMargin] = useState(0);
  const columnCount = libraryColumnCount(containerWidth, viewportWidth);
  const itemRowCount = libraryRowCount(items.length, columnCount);
  const hasStatusRow = hasNextPage || isFetchingNextPage || nextPageError;
  const rowVirtualizer = useVirtualizer({
    count: itemRowCount + (hasStatusRow ? 1 : 0),
    estimateSize: () => estimatedRowHeight(containerWidth, columnCount),
    getScrollElement: () => scrollElementRef.current,
    overscan: 3,
    scrollMargin,
    useFlushSync: false
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scrollElement = scrollElementRef.current;
    if (!container || !scrollElement) {
      return;
    }
    const nextMargin = container.getBoundingClientRect().top
      - scrollElement.getBoundingClientRect().top
      + scrollElement.scrollTop;
    setScrollMargin((current) => Math.abs(current - nextMargin) < 1 ? current : nextMargin);
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const updateSize = () => {
      setContainerWidth(container.clientWidth);
      setViewportWidth(window.innerWidth);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnCount, rowVirtualizer]);

  useEffect(() => {
    const lastVisibleRow = virtualRows.at(-1);
    if (
      lastVisibleRow
      && lastVisibleRow.index >= Math.max(0, itemRowCount - 1)
      && hasNextPage
      && !isFetchingNextPage
      && !nextPageError
    ) {
      onLoadMore();
    }
  }, [hasNextPage, isFetchingNextPage, itemRowCount, nextPageError, onLoadMore, virtualRows]);

  return (
    <section
      aria-busy={isFetchingNextPage}
      aria-label="Videos"
      className="virtualLibrary"
      ref={containerRef}
      role="list"
    >
      <div className="virtualLibraryCanvas" style={{ height: rowVirtualizer.getTotalSize() }}>
        {virtualRows.map((virtualRow) => {
          const isStatusRow = virtualRow.index >= itemRowCount;
          return (
            <div
              className={isStatusRow ? 'virtualLibraryStatusRow' : 'virtualLibraryRow'}
              data-index={virtualRow.index}
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              role="presentation"
              style={{
                gridTemplateColumns: isStatusRow ? '1fr' : `repeat(${columnCount}, minmax(0, 1fr))`,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`
              }}
            >
              {isStatusRow ? (
                <LibraryLoadStatus
                  isFetching={isFetchingNextPage}
                  loaded={items.length}
                  nextPageError={nextPageError}
                  onRetry={onLoadMore}
                  total={total}
                />
              ) : libraryRowItems(items, virtualRow.index, columnCount).map((item, columnIndex) => {
                const itemIndex = virtualRow.index * columnCount + columnIndex;
                return (
                  <VideoCard
                    activeLabel={activeLabel}
                    item={item}
                    itemIndex={itemIndex}
                    key={item.id}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onPlay={onPlay}
                    onSelectLabel={onSelectLabel}
                    total={total}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <span aria-live="polite" className="srOnly">
        {isFetchingNextPage ? `Loading more videos. ${items.length} of ${total} loaded.` : `${items.length} of ${total} videos loaded.`}
      </span>
    </section>
  );
}

function VideoCard({
  activeLabel,
  item,
  itemIndex,
  onDelete,
  onEdit,
  onPlay,
  onSelectLabel,
  total
}: {
  activeLabel: string | null;
  item: MediaItem;
  itemIndex: number;
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onSelectLabel: (label: string) => void;
  total: number;
}) {
  return (
    <article aria-posinset={itemIndex + 1} aria-setsize={total} className="videoCard" role="listitem">
      <button aria-label={`Play ${item.title}`} className="poster" onClick={() => onPlay(item)} type="button">
        {item.thumbnailPath ? (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
            src={`/thumbnails/${item.id}`}
          />
        ) : (
          <span className="posterPlaceholder" />
        )}
        <span className="playBadge" aria-hidden="true">
          <PlayIcon />
        </span>
        <span className="durationBadge">{formatDuration(item.durationSeconds)}</span>
      </button>
      <div className="videoMeta">
        <h2>{item.title}</h2>
        <p>{formatResolution(item)} · {formatBytes(item.sizeBytes)}</p>
        {item.labels.length > 0 ? (
          <div aria-label="Video labels" className="videoCardLabels" role="group">
            {item.labels.map((label) => (
              <button
                aria-label={`Filter videos by ${label}`}
                aria-pressed={activeLabel?.toLowerCase() === label.toLowerCase()}
                className="videoCardLabel"
                key={label.toLowerCase()}
                onClick={() => onSelectLabel(label)}
                title={`Show videos labeled ${label}`}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <MediaActionsMenu item={item} onDelete={onDelete} onEdit={onEdit} />
      </div>
    </article>
  );
}

function LibraryLoadStatus({
  isFetching,
  loaded,
  nextPageError,
  onRetry,
  total
}: {
  isFetching: boolean;
  loaded: number;
  nextPageError: boolean;
  onRetry: () => void;
  total: number;
}) {
  if (nextPageError) {
    return (
      <div className="libraryLoadStatus" role="alert">
        <span>Couldn’t load more videos. {loaded} of {total} remain available.</span>
        <button className="secondaryButton" onClick={onRetry} type="button">Try again</button>
      </div>
    );
  }
  return <div className="libraryLoadStatus" role="status">{isFetching ? `Loading more videos… ${loaded} of ${total}` : `${loaded} of ${total} videos loaded`}</div>;
}

function estimatedRowHeight(containerWidth: number, columnCount: number): number {
  const width = Math.max(280, (containerWidth - LIBRARY_GRID_GAP * (columnCount - 1)) / columnCount);
  return Math.ceil(width * 9 / 16 + 100 + LIBRARY_GRID_GAP);
}

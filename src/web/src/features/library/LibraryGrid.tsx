import { EditIcon, PlayIcon, TrashIcon } from '../../components/icons';
import type { Category, MediaItem } from '../../lib/api';
import { formatBytes, formatDuration, formatResolution } from '../../utils/format';

export function LibraryGrid({
  categories,
  categoryName,
  items,
  onAdd,
  onCreateCategory,
  onDelete,
  onEdit,
  onPlay
}: {
  categories: Category[];
  categoryName: string | null;
  items: MediaItem[];
  onAdd: () => void;
  onCreateCategory: () => void;
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="emptyState">
        <PlayIcon />
        <h2>{categoryName ? `No videos in ${categoryName}` : 'Start your library'}</h2>
        <p>
          {categoryName
            ? 'Add a video link; completed downloads will appear here.'
            : 'Create a category or add a video link to begin your local library.'}
        </p>
        <div className="emptyStateActions">
          <button className="primaryButton" onClick={onAdd} type="button">
            {categoryName ? 'Add video' : 'Add first video'}
          </button>
          {!categoryName ? (
            <button className="secondaryButton" onClick={onCreateCategory} type="button">
              Create category
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="libraryGrid" aria-label="Videos">
      {items.map((item) => (
        <article className="videoCard" key={item.id}>
          <button aria-label={`Play ${item.title}`} className="poster" onClick={() => onPlay(item)} type="button">
            {item.thumbnailPath ? (
              <img
                alt=""
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
            <span>{categories.find((category) => category.id === item.categoryId)?.name ?? 'Unknown'}</span>
          </div>
          <div className="cardActions">
            <button aria-label={`Edit ${item.title}`} onClick={() => onEdit(item)} title="Rename or move" type="button">
              <EditIcon />
            </button>
            <button aria-label={`Delete ${item.title}`} onClick={() => void onDelete(item)} title="Delete" type="button">
              <TrashIcon />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

import { EditIcon, PlayIcon, TrashIcon } from '../../components/icons';
import type { Category, MediaItem } from '../../lib/api';
import { formatBytes, formatDuration, formatResolution } from '../../utils/format';

export function LibraryGrid({
  categories,
  items,
  onDelete,
  onEdit,
  onPlay
}: {
  categories: Category[];
  items: MediaItem[];
  onDelete: (item: MediaItem) => void;
  onEdit: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="emptyState">
        <PlayIcon />
        <h2>No videos in this category</h2>
        <p>Add a link above; completed downloads will appear here.</p>
      </section>
    );
  }

  return (
    <section className="libraryGrid" aria-label="Videos">
      {items.map((item) => (
        <article className="videoCard" key={item.id}>
          <button className="poster" onClick={() => onPlay(item)} type="button">
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
            <button onClick={() => onEdit(item)} title="Rename or move" type="button">
              <EditIcon />
            </button>
            <button onClick={() => void onDelete(item)} title="Delete" type="button">
              <TrashIcon />
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

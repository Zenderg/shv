import type { CategoryLabelSummary } from '../../lib/api';

export function CategoryLabelBar({
  activeLabel,
  onManage,
  onSelect,
  summary
}: {
  activeLabel: string | null;
  onManage: () => void;
  onSelect: (label: string | null) => void;
  summary: CategoryLabelSummary;
}) {
  if (summary.items.length === 0) {
    return null;
  }
  return (
    <section aria-label="Filter videos by label" className="categoryLabelBar">
      <div className="categoryLabelScroller">
        <button
          aria-pressed={activeLabel === null}
          className="filterChip"
          onClick={() => onSelect(null)}
          type="button"
        >
          All
        </button>
        {summary.items.map((label) => (
          <button
            aria-pressed={activeLabel?.toLowerCase() === label.name.toLowerCase()}
            className="filterChip"
            key={label.name.toLowerCase()}
            onClick={() => onSelect(label.name)}
            title={`${label.name}: ${label.count} videos`}
            type="button"
          >
            <span>{label.name}</span>
            <span aria-hidden="true" className="filterChipCount">{label.count}</span>
          </button>
        ))}
      </div>
      <button className="manageLabelsButton" onClick={onManage} type="button">Manage</button>
    </section>
  );
}

import { CloseIcon } from '../../components/icons';

export interface CompletionNotice {
  categoryId: string;
  categoryName: string;
  jobId: string;
  title: string;
}

export function CompletionToasts({
  announcement,
  notices,
  onDismiss,
  onOpenCategory
}: {
  announcement: string;
  notices: CompletionNotice[];
  onDismiss: (jobId: string) => void;
  onOpenCategory: (notice: CompletionNotice) => void;
}) {
  return (
    <aside aria-label="Completed downloads" className="completionToasts">
      <p aria-atomic="true" aria-live="polite" className="srOnly" role="status">{announcement}</p>
      {notices.map((notice) => (
        <article className="completionToast" key={notice.jobId}>
          <div>
            <strong>Saved to {notice.categoryName}</strong>
            <p>{notice.title}</p>
          </div>
          <div className="completionToastActions">
            <button className="completionOpenButton" onClick={() => onOpenCategory(notice)} type="button">
              Open category
            </button>
            <button aria-label={`Dismiss completion for ${notice.title}`} className="completionDismissButton" onClick={() => onDismiss(notice.jobId)} type="button">
              <CloseIcon />
            </button>
          </div>
        </article>
      ))}
    </aside>
  );
}

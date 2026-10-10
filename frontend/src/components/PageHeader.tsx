import { Provenance } from './Provenance';

/**
 * PageHeader: title, one-sentence purpose, optional actions and a provenance line.
 * Accepts both the current props (eyebrow/title/lede/actions) and the legacy
 * ones (title/subtitle/action) so every existing page keeps working.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  subtitle,
  actions,
  action,
  source,
  updatedAt,
  note,
  demo,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  action?: React.ReactNode;
  source?: string;
  updatedAt?: string | null;
  note?: string;
  demo?: boolean;
}) {
  const body = lede ?? subtitle;
  const right = actions ?? action;
  return (
    <header className="rf-head rf-rise">
      <div className="rf-head-main">
        {eyebrow && <p className="rf-kicker">{eyebrow}</p>}
        <h1 className="rf-title">{title}</h1>
        {body && <p className="rf-lede">{body}</p>}
      </div>
      {right && <div className="rf-head-actions">{right}</div>}
      {source && (
        <div style={{ flexBasis: '100%' }}>
          <Provenance source={source} updatedAt={updatedAt} note={note} demo={demo} />
        </div>
      )}
    </header>
  );
}

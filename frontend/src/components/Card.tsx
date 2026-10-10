export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rf-card ${className || ''}`}>
      {(title || action) && (
        <header className="rf-card-head">
          <div>
            {title && <div className="rf-card-title">{title}</div>}
            {subtitle && <div className="rf-card-sub">{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="rf-card rf-kpi">
      <span className="rf-kpi-label">{label}</span>
      <span className="rf-kpi-value">{value}</span>
      {meta && <span className="rf-kpi-meta">{meta}</span>}
    </div>
  );
}

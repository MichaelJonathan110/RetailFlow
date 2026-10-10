import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="rf-empty" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }} role="status">
      <Loader2 size={15} className="rf-spin" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ label = 'No data yet.', hint }: { label?: string; hint?: string }) {
  return (
    <div className="rf-empty">
      <Inbox size={20} style={{ opacity: 0.4, marginBottom: 6 }} />
      <div>{label}</div>
      {hint && <div style={{ fontSize: 11.5, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rf-alert" data-tone="danger" style={{ display: 'flex', alignItems: 'center', gap: 10 }} role="alert">
      <AlertTriangle size={15} />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button className="rf-btn" data-variant="ghost" onClick={onRetry}>
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

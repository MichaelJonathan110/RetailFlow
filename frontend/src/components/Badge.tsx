export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' |
  'success' | 'warning';

/**
 * Status label. Used only for real state (job status, quality check, connection).
 * Never decorative. Accepts both the legacy tone names (success/warning) and the
 * current ones (ok/warn).
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className="rf-badge" data-tone={tone}>{children}</span>;
}

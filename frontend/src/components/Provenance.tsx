import { Badge } from './Badge';
import { formatDateTime } from '@/lib/format';

/**
 * Data-provenance footer required on every data view: where the numbers came from
 * and when they were last refreshed. Never renders a fabricated timestamp.
 */
export function Provenance({
  source,
  updatedAt,
  note,
  demo,
}: {
  source: string;
  updatedAt?: string | null;
  note?: string;
  demo?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 11.5,
        color: 'var(--rf-text-dim)',
        marginTop: 12,
        borderTop: '1px solid var(--rf-border)',
        paddingTop: 10,
      }}
    >
      <span>
        Source: <strong style={{ color: 'var(--rf-text-muted)', fontWeight: 600 }}>{source}</strong>
      </span>
      <span>
        Last updated:{' '}
        <strong style={{ color: 'var(--rf-text-muted)', fontWeight: 600 }}>
          {updatedAt ? formatDateTime(updatedAt) : 'not yet loaded'}
        </strong>
      </span>
      {demo && <Badge tone="info">Synthetic demo data</Badge>}
      {note && <span style={{ flexBasis: '100%' }}>{note}</span>}
    </div>
  );
}

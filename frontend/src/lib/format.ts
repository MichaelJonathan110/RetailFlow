/** Shared display formatters. All numeric rendering goes through here so the UI is consistent. */

export function formatNumber(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCurrency(value: number | string | null | undefined, currency = 'BRL'): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2 });
}

export function formatCompact(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
}

export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Map any status string used by the backend onto a badge tone. */
export function statusTone(status: string | null | undefined): Tone {
  switch ((status || '').toLowerCase()) {
    case 'completed':
    case 'passed':
    case 'ok':
    case 'active':
    case 'ready':
    case 'delivered':
      return 'success';
    case 'running':
    case 'processing':
    case 'warning':
    case 'shipped':
    case 'completed_with_rejects':
      return 'warning';
    case 'failed':
    case 'error':
    case 'canceled':
    case 'unavailable':
      return 'danger';
    case 'queued':
    case 'created':
    case 'invoiced':
      return 'info';
    default:
      return 'neutral';
  }
}

export function severityTone(severity: string | null | undefined): Tone {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return 'danger';
    case 'high': return 'warning';
    case 'medium': return 'info';
    default: return 'neutral';
  }
}

'use client';

import { useState } from 'react';
import { api, type ListResponse, type QualityResult, type RejectedRecord } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { Provenance } from '@/components/Provenance';
import { formatCompact, formatDateTime, formatNumber, formatPercent, severityTone, statusTone } from '@/lib/format';

const SUBTITLE =
  'Rule-based validation across every dataset: pass rates, failed checks and the rows held back with reasons.';

type QualitySummary = Record<string, number>;

interface Rule {
  rule_code: string;
  dataset?: string;
  severity?: string;
  is_active?: boolean;
  description?: string;
}

export default function QualityPage() {
  const [open, setOpen] = useState<number | null>(null);
  const summary = useApi<QualitySummary>(() => api.get<QualitySummary>('/quality/summary'));
  const results = useApi<ListResponse<QualityResult>>(() => api.get<ListResponse<QualityResult>>('/quality/results'));
  const rules = useApi<ListResponse<Rule>>(() => api.get<ListResponse<Rule>>('/quality/rules'));
  const rejected = useApi<ListResponse<RejectedRecord>>(() =>
    api.get<ListResponse<RejectedRecord>>('/quality/rejected'),
  );

  const s = summary.data || {};
  const resultRows = results.data?.items ?? [];
  const ruleRows = rules.data?.items ?? [];
  const rejectRows = rejected.data?.items ?? [];

  const passRates = resultRows.map((r) => Number(r.pass_rate)).filter((n) => !Number.isNaN(n));
  const avgPass = passRates.length ? passRates.reduce((a, b) => a + b, 0) / passRates.length : null;
  const failedChecks = resultRows.filter((r) => (r.status || '').toLowerCase() !== 'passed').length;

  const resultCols: Column<QualityResult>[] = [
    { key: 'rule', header: 'Rule', render: (r) => <code className="rf-mono">{r.rule_code}</code> },
    { key: 'dataset', header: 'Dataset', render: (r) => r.dataset || '—' },
    { key: 'severity', header: 'Severity', render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'checked', header: 'Checked', align: 'right', render: (r) => formatNumber(r.rows_checked ?? 0) },
    { key: 'failed', header: 'Failed', align: 'right', render: (r) => formatNumber(r.rows_failed ?? 0) },
    { key: 'pass', header: 'Pass rate', align: 'right', render: (r) => formatPercent(r.pass_rate ?? 0) },
    { key: 'at', header: 'Checked at', render: (r) => formatDateTime(r.checked_at) },
  ];

  const ruleCols: Column<Rule>[] = [
    { key: 'rule', header: 'Rule', render: (r) => <code className="rf-mono">{r.rule_code}</code> },
    { key: 'dataset', header: 'Dataset', render: (r) => r.dataset || '—' },
    { key: 'severity', header: 'Severity', render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity || 'info'}</Badge> },
    { key: 'active', header: 'State', render: (r) => <Badge tone={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'active' : 'off'}</Badge> },
    { key: 'desc', header: 'Description', render: (r) => r.description || '—' },
  ];

  const rejectCols: Column<RejectedRecord>[] = [
    { key: 'id', header: 'ID', render: (r) => <code className="rf-mono">{r.reject_id}</code> },
    { key: 'dataset', header: 'Dataset', render: (r) => r.dataset },
    { key: 'row', header: 'Row', align: 'right', render: (r) => formatNumber(r.row_number) },
    { key: 'rule', header: 'Rule', render: (r) => <code className="rf-mono">{r.rule_code}</code> },
    { key: 'severity', header: 'Severity', render: (r) => <Badge tone={severityTone(r.severity)}>{r.severity}</Badge> },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    { key: 'at', header: 'When', render: (r) => formatDateTime(r.created_at) },
  ];

  return (
    <>
      <PageHero />

      <div className="rf-kpi-grid rf-stagger">
        <div className="rf-kpi-card" data-tone="green">
          <span className="rf-kpi-label">Average pass rate</span>
          <span className="rf-kpi-value">{avgPass === null ? '—' : formatPercent(avgPass)}</span>
          <span className="rf-kpi-meta">Across {formatNumber(resultRows.length)} checks</span>
        </div>
        <div className="rf-kpi-card" data-tone="blue">
          <span className="rf-kpi-label">Active rules</span>
          <span className="rf-kpi-value">{formatCompact(s.active_rules ?? ruleRows.length)}</span>
          <span className="rf-kpi-meta">Evaluated each run</span>
        </div>
        <div className="rf-kpi-card" data-tone="butter">
          <span className="rf-kpi-label">Failed checks</span>
          <span className="rf-kpi-value">{formatNumber(failedChecks)}</span>
          <span className="rf-kpi-meta">Latest evaluation</span>
        </div>
        <div className="rf-kpi-card" data-tone="lavender">
          <span className="rf-kpi-label">Rejected records</span>
          <span className="rf-kpi-value">{formatNumber(s.rejected_records ?? rejectRows.length)}</span>
          <span className="rf-kpi-meta">Quarantined with reasons</span>
        </div>
      </div>

      <section className="rf-section">
        <h2 className="rf-section-title">Check results</h2>
        <Card title="Latest evaluation" subtitle="One row per rule evaluated on the most recent run.">
          {results.loading && !results.data ? (
            <Loading label="Loading quality results" />
          ) : results.error ? (
            <ErrorState message={results.error} onRetry={results.reload} />
          ) : (
            <DataTable<QualityResult>
              columns={resultCols}
              rows={resultRows}
              emptyLabel="No quality results yet."
              emptyHint="Results appear after the first ETL run."
            />
          )}
        </Card>
      </section>

      <section className="rf-section">
        <h2 className="rf-section-title">Rules</h2>
        <Card title="Validation rules" subtitle="Null, duplicate and referential-integrity checks.">
          {rules.loading && !rules.data ? (
            <Loading label="Loading rules" />
          ) : rules.error ? (
            <ErrorState message={rules.error} onRetry={rules.reload} />
          ) : (
            <DataTable<Rule>
              columns={ruleCols}
              rows={ruleRows}
              emptyLabel="No rules configured."
            />
          )}
        </Card>
      </section>

      <section className="rf-section">
        <h2 className="rf-section-title">Rejected records</h2>
        <Card title="Quarantine" subtitle="Rows held back, with the rule that caught them and why.">
          {rejected.loading && !rejected.data ? (
            <Loading label="Loading rejected records" />
          ) : rejected.error ? (
            <ErrorState message={rejected.error} onRetry={rejected.reload} />
          ) : (
            <DataTable<RejectedRecord>
              columns={rejectCols}
              rows={rejectRows}
              emptyLabel="No rejected records — every row passed."
            />
          )}
        </Card>
        {rejectRows.length > 0 && (
          <div className="rf-panel" style={{ marginTop: 14 }}>
            <h3 className="rf-panel-title">Inspect a rejected payload</h3>
            <p className="rf-panel-sub">Pick a record to see the raw row that failed validation.</p>
            <select
              className="rf-select"
              value={open ?? ''}
              onChange={(e) => setOpen(e.target.value ? Number(e.target.value) : null)}
              aria-label="Select rejected record"
            >
              <option value="">— choose a record —</option>
              {rejectRows.map((r) => (
                <option key={r.reject_id} value={r.reject_id}>
                  #{r.reject_id} · {r.dataset} · row {r.row_number}
                </option>
              ))}
            </select>
            {open !== null && (
              <pre className="rf-log" style={{ marginTop: 12 }}>
                {JSON.stringify(rejectRows.find((r) => r.reject_id === open)?.raw_payload ?? {}, null, 2)}
              </pre>
            )}
          </div>
        )}
        <Provenance source="GET /quality/summary · /quality/results · /quality/rules · /quality/rejected" updatedAt={null} note="Live data-quality engine output." />
      </section>

      <section className="rf-section">
        <h2 className="rf-section-title">How validation works</h2>
        <div className="rf-insight-grid">
          <div className="rf-insight">
            <div className="rf-insight-mark" data-tone="blue" aria-hidden />
            <div>
              <h4>Null &amp; required-field checks</h4>
              <p>Columns declared non-nullable are verified on every batch; blank required values reject the row.</p>
            </div>
          </div>
          <div className="rf-insight">
            <div className="rf-insight-mark" data-tone="lavender" aria-hidden />
            <div>
              <h4>Duplicate detection</h4>
              <p>Natural keys are checked for duplicates within a batch and against rows already loaded.</p>
            </div>
          </div>
          <div className="rf-insight">
            <div className="rf-insight-mark" data-tone="green" aria-hidden />
            <div>
              <h4>Referential integrity</h4>
              <p>Foreign keys must resolve to existing dimension members, or the fact row is held back.</p>
            </div>
          </div>
          <div className="rf-insight">
            <div className="rf-insight-mark" data-tone="butter" aria-hidden />
            <div>
              <h4>Quarantine with reasons</h4>
              <p>Every rejected row is stored with its rule code, severity and the raw payload for review.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PageHero() {
  return (
    <header className="rf-hero rf-rise">
      <p className="rf-eyebrow">Assurance</p>
      <h1 className="rf-display">Data quality</h1>
      <p className="rf-lede">{SUBTITLE}</p>
    </header>
  );
}

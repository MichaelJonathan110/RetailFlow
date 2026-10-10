'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Card } from '@/components/Card';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';

const SUBTITLE =
  'Platform configuration and how to run RetailFlow end to end.';

type SettingsMap = Record<string, unknown>;

function groupOf(key: string): string {
  const i = key.indexOf('.');
  return i > 0 ? key.slice(0, i) : 'general';
}

function prettify(key: string): string {
  const tail = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return tail.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function SettingsPage() {
  const settings = useApi<SettingsMap>(() => api.get<SettingsMap>('/settings'));
  const [saved, setSaved] = useState<string | null>(null);

  const data = settings.data || {};
  const groups = useMemo(() => {
    const out: Record<string, [string, unknown][]> = {};
    Object.entries(data).forEach(([k, v]) => {
      const g = groupOf(k);
      (out[g] = out[g] || []).push([k, v]);
    });
    return Object.entries(out).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <>
      <PageHeader title="Settings" subtitle={SUBTITLE} />

      {settings.loading && !settings.data ? (
        <Loading label="Loading settings" />
      ) : settings.error ? (
        <ErrorState message={settings.error} onRetry={settings.reload} />
      ) : groups.length === 0 ? (
        <Card title="Configuration">
          <p className="rf-panel-sub">No settings were returned by the API.</p>
        </Card>
      ) : (
        <div className="rf-grid-2 rf-stagger">
          {groups.map(([group, entries]) => (
            <Card key={group} title={group.replace(/\b\w/g, (c) => c.toUpperCase())} subtitle={`${entries.length} key${entries.length === 1 ? '' : 's'}`}>
              <div className="rf-dl">
                {entries.map(([k, v]) => (
                  <div key={k} className="rf-dl-row">
                    <span className="rf-dl-key">{prettify(k)}</span>
                    <span className="rf-dl-val">
                      {typeof v === 'boolean' ? (
                        <span className="rf-dot" data-on={v} aria-hidden />
                      ) : null}
                      <code className="rf-mono">{renderValue(v)}</code>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <section className="rf-section">
        <h2 className="rf-section-title">Run the platform</h2>
        <Card title="Documentation" subtitle="Everything needed to bring RetailFlow up locally.">
          <div className="rf-dl">
            <div className="rf-dl-row"><span className="rf-dl-key">Backend API</span><span className="rf-dl-val"><code className="rf-mono">uvicorn app.main:app --port 8020</code> · base <code className="rf-mono">http://127.0.0.1:8020/api/v1</code></span></div>
            <div className="rf-dl-row"><span className="rf-dl-key">Frontend</span><span className="rf-dl-val"><code className="rf-mono">cd frontend &amp;&amp; npm run dev</code> · <code className="rf-mono">http://localhost:3000</code></span></div>
            <div className="rf-dl-row"><span className="rf-dl-key">Database</span><span className="rf-dl-val">PostgreSQL with schemas <code className="rf-mono">app</code>, <code className="rf-mono">staging</code>, <code className="rf-mono">warehouse</code>, <code className="rf-mono">ops</code></span></div>
            <div className="rf-dl-row"><span className="rf-dl-key">Ingestion</span><span className="rf-dl-val">Upload CSVs from the Data sources page; rules validate and quarantine bad rows.</span></div>
            <div className="rf-dl-row"><span className="rf-dl-key">Orchestration</span><span className="rf-dl-val">Pipelines run on demand from the Pipelines page; every run is logged under ETL monitoring.</span></div>
            <div className="rf-dl-row"><span className="rf-dl-key">Sample data</span><span className="rf-dl-val">Synthetic datasets are labelled in the UI — never presented as production figures.</span></div>
          </div>
          {saved && <p className="rf-note rf-note-ok">{saved}</p>}
        </Card>
        <Provenance source="GET /settings" updatedAt={null} note="Read-only configuration exposed by the API." />
      </section>
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Table2, ChevronRight, Database, Clock, Rows3, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Loading, ErrorState } from '@/components/States';

const STARTER = 'select\n  date_trunc(\'month\', o.order_ts) as month,\n  count(*) as order_items,\n  sum(o.quantity) as units\nfrom warehouse.fact_order_items o\ngroup by 1\norder by 1\ndesc\nlimit 100';

type CatalogTable = { schema: string; table: string; columns: { name: string; type: string; nullable: boolean }[] };
type QueryResult = {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
  statement_timeout_ms: number;
};

function isNumericColumn(rows: QueryResult['rows'], idx: number) {
  let seen = 0;
  for (const r of rows.slice(0, 25)) {
    const v = r[idx];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') { seen += 1; continue; }
    return false;
  }
  return seen > 0;
}

function fmtCell(v: string | number | boolean | null) {
  if (v === null) return <span className="rf-null">NULL</span>;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export default function ExplorerPage() {
  const [catalog, setCatalog] = useState<CatalogTable[] | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [openSchema, setOpenSchema] = useState<Record<string, boolean>>({ warehouse: true });
  const [sql, setSql] = useState(STARTER);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const loadCatalog = useCallback(() => {
    setCatErr(null);
    api
      .get<{ items: CatalogTable[] }>('/explorer/catalog')
      .then((d) => setCatalog(d.items))
      .catch((e) => setCatErr(e?.message || 'Could not load the catalog.'));
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const grouped = useMemo(() => {
    const by: Record<string, CatalogTable[]> = {};
    for (const t of catalog || []) (by[t.schema] ||= []).push(t);
    return by;
  }, [catalog]);

  const run = useCallback(async () => {
    setRunning(true);
    setErr(null);
    try {
      const res = await api.post<QueryResult>('/explorer/query', { sql, limit: 200 });
      setResult(res);
    } catch (e: any) {
      setResult(null);
      const detail = e?.details?.detail ? ` — ${e.details.detail}` : '';
      setErr((e?.message || 'Query failed.') + detail);
    } finally {
      setRunning(false);
    }
  }, [sql]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = editorRef.current;
      if (!el) return;
      const s = el.selectionStart;
      const v = el.value.slice(0, s) + '  ' + el.value.slice(el.selectionEnd);
      setSql(v);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };

  const insert = (t: CatalogTable) => {
    setSql(`select *\nfrom ${t.schema}.${t.table}\nlimit 100`);
    editorRef.current?.focus();
  };

  const numericCols = result ? result.columns.map((_, i) => isNumericColumn(result.rows, i)) : [];

  return (
    <>
      <PageHeader
        eyebrow="Warehouse"
        title="SQL explorer"
        lede="Run read-only SELECT queries against the live PostgreSQL warehouse. One statement at a time, 5-second timeout, 200 rows by default."
        source="PostgreSQL · information_schema + live query"
        note="Read-only. Writes are rejected by the API and blocked by a READ ONLY transaction."
        demo
      />

      <div className="rf-explorer">
        <aside className="rf-exp-side">
          <div className="rf-exp-side-head">
            <Database size={14} />
            <span>Catalog</span>
          </div>
          {catErr && <ErrorState message={catErr} onRetry={loadCatalog} />}
          {!catalog && !catErr && <Loading label="Loading catalog…" />}
          {catalog && (
            <div className="rf-exp-tree">
              {Object.entries(grouped).map(([schema, tables]) => {
                const open = openSchema[schema] ?? false;
                return (
                  <div key={schema} className="rf-exp-schema">
                    <button
                      className="rf-exp-schema-btn"
                      aria-expanded={open}
                      onClick={() => setOpenSchema((s) => ({ ...s, [schema]: !open }))}
                    >
                      <ChevronRight size={13} className="rf-exp-chev" data-open={open} />
                      <span className="rf-mono">{schema}</span>
                      <span className="rf-exp-count">{tables.length}</span>
                    </button>
                    {open && (
                      <ul className="rf-exp-tables">
                        {tables.map((t) => (
                          <li key={t.schema + '.' + t.table}>
                            <button className="rf-exp-table" onClick={() => insert(t)} title={`SELECT from ${t.schema}.${t.table}`}>
                              <Table2 size={12} />
                              <span className="rf-mono">{t.table}</span>
                              <span className="rf-exp-count">{t.columns.length}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <section className="rf-exp-main">
          <div className="rf-exp-editor">
            <div className="rf-exp-editor-head">
              <span className="rf-exp-label">Query</span>
              <span className="rf-exp-hint">Ctrl/⌘ + Enter to run · Tab inserts spaces</span>
            </div>
            <textarea
              ref={editorRef}
              className="rf-sql"
              spellCheck={false}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="SQL query"
              rows={8}
            />
            <div className="rf-exp-actions">
              <button className="rf-btn" data-variant="primary" onClick={run} disabled={running}>
                <Play size={13} /> {running ? 'Running…' : 'Run query'}
              </button>
              {result && (
                <span className="rf-exp-stats">
                  <span><Rows3 size={12} /> {result.row_count} rows</span>
                  <span><Clock size={12} /> {result.elapsed_ms} ms</span>
                  {result.truncated && <span className="rf-exp-warn"><TriangleAlert size={12} /> truncated to {result.row_count}</span>}
                </span>
              )}
            </div>
          </div>

          {err && <div className="rf-alert" data-tone="danger" role="alert"><TriangleAlert size={14} /> <span>{err}</span></div>}

          {result && result.row_count === 0 && (
            <div className="rf-empty">The query ran and returned no rows. Widen the filter or check the table is loaded.</div>
          )}

          {result && result.row_count > 0 && (
            <div className="rf-table-wrap rf-exp-results">
              <table className="rf-table">
                <thead>
                  <tr>
                    {result.columns.map((c, i) => (
                      <th key={c + i} data-numeric={numericCols[i] || undefined}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((v, ci) => (
                        <td key={ci} data-numeric={numericCols[ci] || undefined}>{fmtCell(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/* rf-editorial-shell */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, Bell, Boxes, Clock, Database, FileUp, LayoutDashboard, ListChecks, Menu, Server, Settings, ShieldCheck, Workflow, X, Search, CircleCheck, CircleAlert, Terminal,
} from 'lucide-react';
import { api, type HealthResponse } from '@/lib/api';
import { getToken } from '@/lib/auth';

const NAV: { group: string; items: { href: string; label: string; icon: React.ElementType }[] }[] = [
  {
    group: 'Monitor',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/monitoring', label: 'ETL monitoring', icon: Activity },
      { href: '/alerts', label: 'Alert Center', icon: Bell },
      { href: '/freshness', label: 'Freshness & SLA', icon: Clock },
    ],
  },
  {
    group: 'Data engineering',
    items: [
      { href: '/sources', label: 'Data sources', icon: Server },
      { href: '/pipelines', label: 'Pipelines', icon: Workflow },
      { href: '/ingestion', label: 'Ingestion', icon: FileUp },
      { href: '/quality', label: 'Data quality', icon: ShieldCheck },
      { href: '/reconciliation', label: 'Reconciliation', icon: ListChecks },
    ],
  },
  {
    group: 'Warehouse & analytics',
    items: [
      { href: '/warehouse', label: 'Warehouse', icon: Database },
      { href: '/explorer', label: 'SQL explorer', icon: Terminal },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    group: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api.get<HealthResponse>('/health');
        if (!alive) return;
        setHealth(data);
        if (data.auth_enabled && !getToken() && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      } catch { /* keep last known */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const dbOk = health?.database?.connected === true;

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return NAV.flatMap((g) => g.items.map((it) => ({ ...it, group: g.group })))
      .filter((it) => it.label.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [q]);

  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="rf-shell">
      {open && <div className="rf-scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside className="rf-sidebar" data-open={open}>
        <div className="rf-brand">
          <div className="rf-brand-mark" aria-hidden>
            <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" aria-hidden><rect x="0" y="0" width="256" height="256" rx="26" fill="#0E0D0F"/><g fill="#FEFBF7"><path d="M34 54h26v124H34z"/><path d="M60 54h64v26H60z"/><path d="M98 80h26v38H98z"/><path d="M60 118h64v26H60z"/><path d="M104 144h26v40h-26z"/><path d="M140 54h26v124h-26z"/><path d="M166 54h56v26h-56z"/><path d="M166 104h44v26h-44z"/></g><rect x="34" y="198" width="188" height="16" fill="#FED01A"/></svg>
          </div>
          <div>
            <div className="rf-brand-name">RetailFlow</div>
            <div className="rf-brand-sub">Retail data platform</div>
          </div>
        </div>
        <nav className="rf-nav">
          {NAV.map((group) => (
            <div className="rf-nav-group" key={group.group}>
              <div className="rf-nav-label">{group.group}</div>
              {group.items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="rf-nav-item" data-active={active}>
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="rf-side-foot">
          <span className="rf-dot" data-ok={dbOk} />
          <span>{dbOk ? 'Warehouse connected' : 'Warehouse offline'}</span>
          <span className="rf-side-ver">v{health?.version || '1.0.0'}</span>
        </div>
      </aside>

      <div className="rf-main">
        <header className="rf-topbar">
          <button className="rf-btn rf-menu-btn" data-variant="ghost" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
          <div className="rf-search">
            <Search size={14} />
            <input
              className="rf-search-input"
              placeholder="Search pages…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search pages"
            />
            {results.length > 0 && (
              <div className="rf-search-pop">
                {results.map((r) => (
                  <Link key={r.href} href={r.href} className="rf-search-item" onClick={() => setQ('')}>
                    <r.icon size={14} />
                    <span>{r.label}</span>
                    <span className="rf-search-group">{r.group}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="rf-top-right">
            <span className="rf-health" data-ok={dbOk} title={health?.database?.error || undefined}>
              {dbOk ? <CircleCheck size={13} /> : <CircleAlert size={13} />}
              <span className="rf-health-txt">{health ? health.environment : 'connecting'}</span>
            </span>
          </div>
        </header>
        <div className="rf-banner">
          <Boxes size={13} />
          <span>
            Demo environment — the warehouse is loaded from a <strong>deterministic synthetic fixture</strong>, not real
            customer data. See <code className="rf-mono">sample-data/manifest.json</code>.
          </span>
        </div>
        <main className="rf-page">{children}</main>
      </div>
    </div>
  );
}

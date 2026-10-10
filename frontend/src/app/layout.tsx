import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import './globals.css';

export const metadata: Metadata = {
  title: 'RetailFlow — Retail Data Engineering Platform',
  description:
    'RetailFlow: ETL orchestration, data quality, reconciliation and retail analytics over a PostgreSQL dimensional warehouse.',
};

// Fonts are declared as CSS stacks in globals.css (Inter / JetBrains Mono with
// system fallbacks) so the build never depends on a network font fetch.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

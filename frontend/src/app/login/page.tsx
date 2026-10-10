'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, type HealthResponse } from '@/lib/api';
import { setToken } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@retailflow.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AUTH_DISABLED_BYPASS: when the backend runs without auth (demo mode) there
  // is nothing to sign into — go straight to the dashboard.
  useEffect(() => {
    let alive = true;
    api
      .get<HealthResponse>('/health')
      .then((h) => {
        if (alive && !h.auth_enabled) router.replace('/');
      })
      .catch(() => {
        /* backend unreachable: keep the form so the error stays visible */
      });
    return () => {
      alive = false;
    };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>('/auth/login', { email, password });
      setToken(res.token);
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rf-login-wrap">
      <form className="rf-login-card" onSubmit={submit}>
        <div className="rf-login-brand">RetailFlow</div>
        <p className="rf-login-sub">Sign in to the retail data platform.</p>
        <label className="rf-login-label">
          Email
          <input
            className="rf-login-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label className="rf-login-label">
          Password
          <input
            className="rf-login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="rf-login-err">{error}</p>}
        <button className="rf-btn rf-login-btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

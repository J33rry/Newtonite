'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, request } from '@/lib/api';
import { Avatar } from '@/components/ui';

interface DevUser {
  email: string;
  name: string;
  is_admin: boolean;
  teams: string;
}

/** Development sign-in (stand-in for SSO): pick one of the seeded demo users. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const users = useQuery({ queryKey: ['dev-users'], queryFn: () => request<{ users: DevUser[] }>('/api/auth/dev-users') });

  const login = async (email: string) => {
    setPending(email);
    setError(null);
    try {
      await request('/api/auth/login', { method: 'POST', json: { email } });
      qc.clear();
      router.replace('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed');
      setPending(null);
    }
  };

  return (
    <div className="login">
      <div className="card login-card">
        <div className="logo" style={{ padding: 0, marginBottom: 18 }}>OpsDesk</div>
        <h1>Sign in</h1>
        <p className="muted" style={{ fontSize: 15, marginTop: 8 }}>
          Development sign-in — choose a demo user. Each has different teams and roles, so you can see authorization and
          collaboration from several sides. Use a second browser to act as two people at once.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {users.isLoading && <p className="muted">Loading users…</p>}
        {users.error && <div className="alert alert-error">Cannot reach the API. Is it running on port 4000?</div>}
        <div className="user-grid">
          {users.data?.users.map((u) => (
            <button key={u.email} onClick={() => login(u.email)} disabled={!!pending} className="user-pick">
              <Avatar name={u.name} large />
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block' }}>
                  {u.name} {u.is_admin && <span className="tag">admin</span>}
                </strong>
                <span className="muted small">{u.teams || 'No team — raises requests only'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { ApiError, newIdempotencyKey, request, type ItemType } from '@/lib/api';
import { TYPE_LABEL } from '@/lib/format';
import { useMe, useTeams } from '@/lib/queries';

const PRIORITY_OPTIONS = [
  [1, 'P1 · Critical'],
  [2, 'P2 · High'],
  [3, 'P3 · Normal'],
  [4, 'P4 · Low'],
] as const;

export default function NewItemPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useTeams();
  const me = useMe();
  const [form, setForm] = useState({ teamId: '', title: '', description: '', type: 'task' as ItemType, priority: 3, requiresApproval: false, dueAt: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // One key per form instance: a double-submit, or a retry after a timeout, creates ONE item.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const teamId = form.teamId || me.data?.teams[0]?.id || teams.data?.[0]?.id || '';
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const item = await request<{ id: string; number: number }>('/api/items', {
        method: 'POST',
        idempotencyKey,
        json: { ...form, teamId, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null },
      });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['insights'] });
      toast.show({ kind: 'success', title: `Created #${item.number}` });
      router.push(`/items/${item.id}`);
    } catch (err) {
      setError(err as ApiError);
      setPending(false);
    }
  };

  const fieldError = (path: string) => error?.details?.issues?.find((i: { path: string }) => i.path === path)?.message;

  return (
    <div>
      <PageHeader title="New work item" subtitle="Send work to the right team. You can follow progress from your workspace." />
      <form className="card form-card" onSubmit={submit}>
        <div className="form-inner">
          {error && <div className="alert alert-error">{error.message}</div>}
          <section className="form-section">
            <h2>Work details</h2>
            <label className="field">
              Team
              <select value={teamId} onChange={(e) => set('teamId', e.target.value)} required>
                {teams.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Title
              <input value={form.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} placeholder="What needs to happen?" autoFocus />
              {fieldError('title') && <span className="field-error">{fieldError('title')}</span>}
            </label>
            <label className="field">
              Context
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={5} placeholder="Customer, links, impact, and what you've already tried…" />
            </label>
          </section>

          <section className="form-section">
            <h2>Scheduling &amp; review</h2>
            <div className="grid-3">
              <label className="field">
                Type
                <select value={form.type} onChange={(e) => set('type', e.target.value as ItemType)}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Priority
                <select value={form.priority} onChange={(e) => set('priority', Number(e.target.value))}>
                  {PRIORITY_OPTIONS.map(([p, l]) => (
                    <option key={p} value={p}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>
                  Due date <span className="opt">Optional</span>
                </span>
                <input type="datetime-local" value={form.dueAt} onChange={(e) => set('dueAt', e.target.value)} />
              </label>
            </div>
            <label className="check-panel">
              <input type="checkbox" checked={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.checked)} />
              <UsersRound size={20} className="muted" />
              Requires approval by a team lead before work can start
            </label>
          </section>

          <div className="form-foot">
            <button className="btn btn-primary" disabled={pending} style={{ height: 46, padding: '0 26px' }}>
              {pending ? 'Creating…' : 'Create item'}
            </button>
            <button type="button" className="btn" onClick={() => router.back()} style={{ height: 46, padding: '0 26px' }}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

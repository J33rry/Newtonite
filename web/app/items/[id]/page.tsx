'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Person, PriorityPill, StatusPill } from '@/components/ui';
import { ChevronRight, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { Timeline } from '@/components/Timeline';
import { EditPanel } from '@/components/EditPanel';
import { ApiError, request, type ItemDetail, type WorkflowAction } from '@/lib/api';
import { ACTION_LABEL, absoluteTime, isOverdue, PRIORITY_LABEL, relativeTime, TYPE_LABEL } from '@/lib/format';
import { useItem, useItemMutation, useMe, useMembers, useTeams } from '@/lib/queries';

const REASON_REQUIRED: WorkflowAction[] = ['reject', 'block', 'reopen'];

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const { data: item, error, isLoading } = useItem(id);

  if (isLoading) return <p className="muted">Loading…</p>;
  if (error) {
    const e = error as ApiError;
    return (
      <div className="alert alert-error">
        {e.status === 404 ? 'This item does not exist, or you do not have access to it.' : e.message} <Link href="/">Back to dashboard</Link>
      </div>
    );
  }
  if (!item) return null;

  return (
    <div className="detail">
      <div className="detail-main">
        <div className="crumbs">
          <Link href="/items">All work</Link> <ChevronRight size={14} />
          <Link href={`/items?team=${item.team_id}`}>{item.team_name}</Link> <ChevronRight size={14} />
          <span>#{item.number} · {TYPE_LABEL[item.type]}</span>
        </div>
        <EditPanel item={item} />
        <Timeline itemId={item.id} canComment={!!item.permissions.comment} />
      </div>
      <aside className="detail-side">
        <OwnerCard item={item} />
        <WorkflowCard item={item} />
        <DetailsCard item={item} />
      </aside>
    </div>
  );
}

function OwnerCard({ item }: { item: ItemDetail }) {
  const me = useMe();
  const members = useMembers(item.team_id, !!item.permissions.assign);
  // Optimistic: the UI shows you as owner instantly; if someone beat you to it the server says so,
  // the change is rolled back and you are told who owns it now.
  const claim = useItemMutation<void>(item.id, {
    request: (_, key) => request(`/api/items/${item.id}/claim`, { method: 'POST', idempotencyKey: key, json: {} }),
    optimistic: (cur) => ({ ...cur, assignee_id: me.data!.id, assignee_name: me.data!.name, canClaim: false }),
    success: 'You own this item now',
  });
  const release = useItemMutation<void>(item.id, {
    request: (_, key) => request(`/api/items/${item.id}/release`, { method: 'POST', idempotencyKey: key, json: {} }),
    optimistic: (cur) => ({ ...cur, assignee_id: null, assignee_name: null }),
    success: 'Returned to the team queue',
  });
  const assign = useItemMutation<string | null>(item.id, {
    request: (assigneeId, key) =>
      request(`/api/items/${item.id}/assign`, { method: 'POST', idempotencyKey: key, json: { expectedVersion: item.version, assigneeId } }),
    success: (i) => (i.assignee_name ? `Assigned to ${i.assignee_name}` : 'Unassigned'),
  });
  const isMine = item.assignee_id === me.data?.id;

  return (
    <section className="card card-pad">
      <div className="side-title">Owner</div>
      <div className="owner-name"><Person name={item.assignee_name} emptyLabel="Nobody yet" /></div>
      <div className="actions">
        {item.canClaim && (
          <button className="btn btn-primary" onClick={() => claim.run()} disabled={claim.isPending}>
            {claim.isPending ? 'Taking…' : 'Take ownership'}
          </button>
        )}
        {item.assignee_id && (isMine || item.permissions.assign) && item.permissions.release && (
          <button className="btn" onClick={() => release.run()} disabled={release.isPending}>
            {isMine ? 'Release' : 'Unassign'}
          </button>
        )}
      </div>
      {item.permissions.assign && item.status !== 'resolved' && item.status !== 'closed' && (
        <label className="side-field">
          Assign to
          <select value={item.assignee_id ?? ''} onChange={(e) => assign.run(e.target.value || null)} disabled={assign.isPending}>
            <option value="">— Unassigned —</option>
            {members.data
              ?.filter((m) => m.role !== 'viewer')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
          </select>
        </label>
      )}
    </section>
  );
}

function WorkflowCard({ item }: { item: ItemDetail }) {
  const [pendingReason, setPendingReason] = useState<WorkflowAction | null>(null);
  const [reason, setReason] = useState('');
  const move = useItemMutation<{ action: WorkflowAction; reason?: string }>(item.id, {
    request: ({ action, reason }, key) =>
      request(`/api/items/${item.id}/transition`, { method: 'POST', idempotencyKey: key, json: { expectedVersion: item.version, action, reason } }),
    success: (i) => `Moved to ${i.status.replace('_', ' ')}`,
  });

  const run = (action: WorkflowAction) => {
    if (REASON_REQUIRED.includes(action)) {
      setPendingReason(action);
      return;
    }
    move.run({ action });
  };

  return (
    <section className="card card-pad">
      <div className="side-title">Status</div>
      <div className="pill-row">
        <StatusPill status={item.status} />
        <PriorityPill priority={item.priority} />
      </div>
      {item.requires_approval && (
        <div className="approval-note">
          {item.approved_by ? (
            <>
              <ShieldCheck size={16} color="var(--good)" />
              <span>
                Approved by <strong>{item.approved_by_name}</strong> {relativeTime(item.approved_at)}
              </span>
            </>
          ) : (
            <>
              <Lock size={16} className="muted" />
              <span>Requires lead approval before work can start</span>
            </>
          )}
        </div>
      )}
      {item.actions.length > 0 && !pendingReason && (
        <div className="actions">
          {item.actions.map((a) => (
            <button key={a} className={`btn ${a === 'resolve' || a === 'approve' ? 'btn-primary' : ''} ${a === 'reject' ? 'btn-danger' : ''}`} onClick={() => run(a)} disabled={move.isPending}>
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      )}
      {!item.actions.length && <p className="muted small">No actions available to you in this state.</p>}
      {pendingReason && (
        <form
          className="reason"
          onSubmit={(e) => {
            e.preventDefault();
            move.run({ action: pendingReason, reason });
            setPendingReason(null);
            setReason('');
          }}
        >
          <label className="side-field">
            Why? (recorded in the history)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required autoFocus />
          </label>
          <div className="actions">
            <button className="btn btn-primary" disabled={!reason.trim()}>
              {ACTION_LABEL[pendingReason]}
            </button>
            <button type="button" className="btn" onClick={() => setPendingReason(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function DetailsCard({ item }: { item: ItemDetail }) {
  const teams = useTeams();
  const priority = useItemMutation<number>(item.id, {
    request: (p, key) => request(`/api/items/${item.id}`, { method: 'PATCH', idempotencyKey: key, json: { expectedVersion: item.version, priority: p } }),
    optimistic: (cur, p) => ({ ...cur, priority: p }),
    success: (i) => `Priority set to P${i.priority}`,
  });
  const transfer = useItemMutation<string>(item.id, {
    request: (teamId, key) => request(`/api/items/${item.id}/transfer`, { method: 'POST', idempotencyKey: key, json: { expectedVersion: item.version, teamId } }),
    success: 'Transferred',
  });
  const watch = useItemMutation<boolean>(item.id, {
    request: async (on, key) => {
      await request(`/api/items/${item.id}/watch`, { method: on ? 'PUT' : 'DELETE', idempotencyKey: key });
      return request<ItemDetail>(`/api/items/${item.id}`);
    },
    optimistic: (cur, on) => ({ ...cur, watching: on }),
  });

  return (
    <section className="card card-pad">
      <div className="side-title">Details</div>
      <dl className="details-list">
        <dt>Priority</dt>
        <dd>
          {item.permissions.change_priority ? (
            <select value={item.priority} onChange={(e) => priority.run(Number(e.target.value))} disabled={priority.isPending}>
              {[1, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          ) : (
            PRIORITY_LABEL[item.priority]
          )}
        </dd>
        <dt>Team</dt>
        <dd>
          {item.permissions.transfer ? (
            <select value={item.team_id} onChange={(e) => confirm('Transfer to another team? The current owner will be removed.') && transfer.run(e.target.value)}>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            item.team_name
          )}
        </dd>
        <dt>Due</dt>
        <dd className={isOverdue(item.due_at, item.status) ? 'danger-text' : ''} title={absoluteTime(item.due_at)}>
          {item.due_at ? `${relativeTime(item.due_at)}` : '—'}
        </dd>
        <dt>Requested by</dt>
        <dd>{item.created_by_name}</dd>
        <dt>Created</dt>
        <dd title={absoluteTime(item.created_at)}>{relativeTime(item.created_at)}</dd>
        <dt>Last activity</dt>
        <dd title={absoluteTime(item.last_activity_at)}>{relativeTime(item.last_activity_at)}</dd>
        <dt>Version</dt>
        <dd className="muted">v{item.version}</dd>
      </dl>
      <button className="btn btn-sm" onClick={() => watch.run(!item.watching)}>
        {item.watching ? <EyeOff size={15} /> : <Eye size={15} />}
        {item.watching ? 'Stop watching' : 'Watch'} · {item.watcher_count}
      </button>
    </section>
  );
}

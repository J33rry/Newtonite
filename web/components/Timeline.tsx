'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, newIdempotencyKey, request, type ItemEvent } from '@/lib/api';
import { ACTION_LABEL, absoluteTime, PRIORITY_LABEL, relativeTime, STATUS_LABEL, TYPE_LABEL } from '@/lib/format';
import { keys, useEvents, useMe } from '@/lib/queries';
import { useToast } from './Toast';
import { Avatar } from './ui';

const FIELD_NAMES: Record<string, string> = { title: 'title', description: 'description', type: 'type', priority: 'priority', due_at: 'due date' };

function formatValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (field === 'priority') return PRIORITY_LABEL[Number(v)] ?? String(v);
  if (field === 'type') return TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? String(v);
  if (field === 'due_at') return new Date(String(v)).toLocaleString();
  if (field === 'description') return `“${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}”`;
  return `“${String(v)}”`;
}

/** Human-readable sentence for each history event. */
function describe(e: ItemEvent): React.ReactNode {
  const d = e.data;
  switch (e.type) {
    case 'created':
      return <>created this item ({PRIORITY_LABEL[d.priority]}{d.requiresApproval ? ', requires approval' : ''})</>;
    case 'assigned':
      if (d.claimed) return <>took ownership</>;
      if (!d.to) return <>removed {d.from === e.actor_id ? 'themselves' : (e.from_name ?? 'the owner')} as owner</>;
      return <>assigned this to <strong>{e.to_name}</strong>{e.from_name ? <> (was {e.from_name})</> : null}</>;
    case 'status_changed':
      return (
        <>
          {d.action && ACTION_LABEL[d.action as keyof typeof ACTION_LABEL] ? <>{ACTION_LABEL[d.action as keyof typeof ACTION_LABEL].toLowerCase()}: </> : null}
          {STATUS_LABEL[d.from as keyof typeof STATUS_LABEL]} → <strong>{STATUS_LABEL[d.to as keyof typeof STATUS_LABEL]}</strong>
          {d.reason && <blockquote>{d.reason}</blockquote>}
        </>
      );
    case 'updated':
      return (
        <>
          changed{' '}
          {Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>).map(([field, c], i) => (
            <span key={field}>
              {i > 0 && ', '}
              {FIELD_NAMES[field] ?? field} from {formatValue(field, c.from)} to <strong>{formatValue(field, c.to)}</strong>
            </span>
          ))}
        </>
      );
    case 'transferred':
      return <>transferred this from {e.from_name} to <strong>{e.to_name}</strong></>;
    default:
      return <>updated this item</>;
  }
}

export function Timeline({ itemId, canComment }: { itemId: string; canComment: boolean }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useEvents(itemId);
  const events = data?.pages.flatMap((p) => p.events) ?? [];
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  // The key belongs to the comment being written; a retry of the same comment reuses it.
  const [key, setKey] = useState(newIdempotencyKey);

  const comment = useMutation({
    mutationFn: (vars: { body: string; key: string }) =>
      request(`/api/items/${itemId}/comments`, { method: 'POST', idempotencyKey: vars.key, json: { body: vars.body } }),
    retry: (n, err) => err instanceof ApiError && err.retryable && n < 3,
    onSuccess: () => {
      setBody('');
      setKey(newIdempotencyKey());
    },
    onError: (err) => toast.show({ kind: 'error', title: 'Comment not posted', body: `${(err as ApiError).message} — your text is kept, try again.` }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.events(itemId) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim() && !comment.isPending) comment.mutate({ body: body.trim(), key });
  };

  return (
    <section className="card timeline-card">
      <h2>Activity</h2>
      {canComment && (
        <form onSubmit={submit} className="comment-form">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add an update, decision or question…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="actions">
            <button className="btn btn-primary" disabled={!body.trim() || comment.isPending}>
              {comment.isPending ? 'Posting…' : 'Comment'}
            </button>
            <span className="muted small">⌘/Ctrl + Enter</span>
          </div>
        </form>
      )}
      {isLoading && <p className="muted">Loading history…</p>}
      <ol className="events">
        {/* Optimistic: show the comment being posted until the server confirms it. */}
        {comment.isPending && (
          <li className="event comment pending">
            <Avatar name={me.data?.name ?? null} />
            <div className="comment-bubble">
              <strong>{me.data?.name}</strong> <span className="muted small">posting…</span>
              <div className="comment-body">{comment.variables?.body}</div>
            </div>
          </li>
        )}
        {events.map((e) =>
          e.type === 'commented' ? (
            <li key={e.id} className="event comment">
              <Avatar name={e.actor_name} />
              <div className="comment-bubble">
                <strong>{e.actor_name}</strong>{' '}
                <span className="muted small" title={absoluteTime(e.created_at)}>
                  {relativeTime(e.created_at)}
                </span>
                <div className="comment-body">{e.data.body}</div>
              </div>
            </li>
          ) : (
            <li key={e.id} className="event" style={{ paddingLeft: 11 }}>
              <span className="event-dot" />
              <div>
                <strong>{e.actor_name}</strong> {describe(e)}{' '}
                <span className="muted small" title={absoluteTime(e.created_at)}>
                  · {relativeTime(e.created_at)}
                  {e.version ? ` · v${e.version}` : ''}
                </span>
              </div>
            </li>
          ),
        )}
      </ol>
      {hasNextPage && (
        <button className="btn btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? 'Loading…' : 'Show older activity'}
        </button>
      )}
    </section>
  );
}

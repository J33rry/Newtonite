'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { PriorityPill, StatusPill } from './ui';
import { request, type ItemDetail, type ItemType } from '@/lib/api';
import { TYPE_LABEL } from '@/lib/format';
import { useItemMutation } from '@/lib/queries';

type Draft = Pick<ItemDetail, 'title' | 'description' | 'type'>;
const FIELDS: (keyof Draft)[] = ['title', 'description', 'type'];
const FIELD_LABEL: Record<keyof Draft, string> = { title: 'Title', description: 'Description', type: 'Type' };

/**
 * Title/description editing with explicit stale-data handling.
 *
 * The edit starts from a `base` snapshot. If the item's version moves on while you edit (realtime
 * update) or your save is rejected with VERSION_CONFLICT, you see which fields the other person
 * changed next to your own values, and choose: re-apply your edits on top of the latest version,
 * or discard them. Nothing is overwritten silently in either direction.
 */
export function EditPanel({ item }: { item: ItemDetail }) {
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState<ItemDetail>(item);
  const [draft, setDraft] = useState<Draft>(item);

  const save = useItemMutation<Partial<Draft>>(item.id, {
    request: (patch, key) =>
      request(`/api/items/${item.id}`, { method: 'PATCH', idempotencyKey: key, json: { expectedVersion: base.version, ...patch } }),
    success: 'Saved',
    onSuccess: () => setEditing(false),
  });

  const start = () => {
    setBase(item);
    setDraft({ title: item.title, description: item.description, type: item.type });
    setEditing(true);
  };

  const mine = FIELDS.filter((f) => draft[f] !== base[f]);
  const stale = editing && item.version !== base.version;
  const theirs = FIELDS.filter((f) => item[f] !== base[f]);
  const overlapping = mine.filter((f) => theirs.includes(f));

  const submit = () => {
    if (!mine.length) return setEditing(false);
    const patch = Object.fromEntries(mine.map((f) => [f, draft[f]]));
    // On success the editor closes; on VERSION_CONFLICT the latest item is refetched, so `stale`
    // becomes true and the comparison below appears.
    save.run(patch);
  };

  if (!editing) {
    return (
      <div className="item-head">
        <div className="title-row">
          <h1>{item.title}</h1>
          {item.permissions.edit && (
            <button className="btn btn-sm" onClick={start}>
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>
        <div className="pill-row">
          <StatusPill status={item.status} />
          <PriorityPill priority={item.priority} />
          {item.requires_approval && !item.approved_by && <span className="tag">needs approval</span>}
        </div>
        <div className="card description">{item.description || <span className="muted">No description.</span>}</div>
      </div>
    );
  }

  return (
    <div className="card card-pad edit-card" style={{ marginBottom: 20 }}>
      {stale && (
        <div className="alert alert-warning">
          <strong>This item changed while you were editing</strong> (v{base.version} → v{item.version}).
          {theirs.length ? (
            <table className="conflict">
              <thead>
                <tr>
                  <th />
                  <th>Their version</th>
                  <th>Your edit</th>
                </tr>
              </thead>
              <tbody>
                {theirs.map((f) => (
                  <tr key={f} className={overlapping.includes(f) ? 'overlap' : ''}>
                    <th>{FIELD_LABEL[f]}</th>
                    <td>{String(item[f])}</td>
                    <td>{mine.includes(f) ? String(draft[f]) : <span className="muted">(unchanged)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small">The fields you are editing were not changed (status, owner or priority may have).</p>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setBase(item)}>
              {overlapping.length ? 'Keep my edits (overwrite theirs)' : 'Apply my edits on top'}
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Discard my edits
            </button>
          </div>
        </div>
      )}
      <label>
        Title
        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
      </label>
      <label>
        Description
        <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={8} />
      </label>
      <label>
        Type
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ItemType })}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="btn btn-primary" onClick={submit} disabled={save.isPending || stale || !draft.title.trim()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {stale && <span className="muted small">Resolve the change above before saving.</span>}
      </div>
    </div>
  );
}

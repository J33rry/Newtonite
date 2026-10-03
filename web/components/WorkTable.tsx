'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { newIdempotencyKey, type ListItem } from '@/lib/api';
import { isOverdue, relativeTime, TYPE_LABEL } from '@/lib/format';
import { useClaim, useMe } from '@/lib/queries';
import { canClaimRow, Person, PriorityPill, StatusPill } from './ui';

type Column = 'priority' | 'title' | 'status' | 'owner' | 'team' | 'updated' | 'due' | 'actions';

const HEADERS: Record<Column, string> = {
  priority: 'Priority', title: 'Problem', status: 'Status', owner: 'Owner', team: 'Team', updated: 'Updated', due: 'Due', actions: 'Actions',
};

/** The work-item table used by the overview queue and every list view. */
export function WorkTable({ items, columns }: { items: ListItem[]; columns: Column[] }) {
  const me = useMe();
  const claim = useClaim();
  if (!items.length) return <p className="empty">Nothing here — you are all caught up.</p>;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className={c === 'actions' ? 'col-actions' : c === 'team' || c === 'updated' ? 'hide-sm' : ''}>
                {HEADERS[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const overdue = isOverdue(item.due_at, item.status);
            const claiming = claim.isPending && claim.variables?.id === item.id;
            return (
              <tr key={item.id}>
                {columns.map((c) => {
                  switch (c) {
                    case 'priority':
                      return <td key={c} style={{ width: 90 }}><PriorityPill priority={item.priority} /></td>;
                    case 'title':
                      return (
                        <td key={c} className="cell-title">
                          <Link href={`/items/${item.id}`}>
                            <span className="num">#{item.number}</span>
                            {item.title}
                          </Link>
                          <div className="sub">
                            {TYPE_LABEL[item.type]}
                            {item.requires_approval && !item.approved && <span className="tag">needs approval</span>}
                            {overdue && !columns.includes('due') && <span className="tag tag-danger">overdue {relativeTime(item.due_at)}</span>}
                          </div>
                        </td>
                      );
                    case 'status':
                      return <td key={c}><StatusPill status={item.status} /></td>;
                    case 'owner':
                      return <td key={c}><Person name={item.assignee_name} /></td>;
                    case 'team':
                      return <td key={c} className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{item.team_name}</td>;
                    case 'updated':
                      return <td key={c} className="col-muted hide-sm" title={new Date(item.updated_at).toLocaleString()}>{relativeTime(item.updated_at)}</td>;
                    case 'due':
                      return (
                        <td key={c} className={overdue ? 'danger-text' : 'col-muted'} title={item.due_at ? new Date(item.due_at).toLocaleString() : ''}>
                          {item.due_at ? relativeTime(item.due_at) : '—'}
                        </td>
                      );
                    case 'actions':
                      return (
                        <td key={c} className="col-actions">
                          {canClaimRow(me.data, item) ? (
                            <button className="btn btn-primary btn-sm" style={{ minWidth: 86 }} disabled={claiming}
                              onClick={() => claim.mutate({ id: item.id, number: item.number, key: newIdempotencyKey() })}>
                              {claiming ? 'Claiming…' : 'Claim'}
                            </button>
                          ) : (
                            <Link href={`/items/${item.id}`} className="btn btn-outline btn-sm" style={{ minWidth: 86 }}>
                              View <ChevronRight size={15} />
                            </Link>
                          )}
                        </td>
                      );
                  }
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

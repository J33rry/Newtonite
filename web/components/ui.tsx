import type { ReactNode } from 'react';
import { User } from 'lucide-react';
import type { ListItem, Me, Status } from '@/lib/api';
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/format';

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PriorityPill({ priority }: { priority: number }) {
  return (
    <span className={`prio prio-${priority}`} title={PRIORITY_LABEL[priority]}>
      P{priority}
    </span>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function Avatar({ name, large = false }: { name: string | null; large?: boolean }) {
  if (!name) {
    return (
      <span className={`avatar avatar-empty ${large ? 'avatar-lg' : ''}`} aria-hidden>
        <User size={15} />
      </span>
    );
  }
  return (
    <span className={`avatar ${large ? 'avatar-lg' : ''}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Person({ name, emptyLabel = 'Unassigned' }: { name: string | null; emptyLabel?: string }) {
  return (
    <span className="person">
      <Avatar name={name} />
      <span className={name ? '' : 'muted'}>{name ?? emptyLabel}</span>
    </span>
  );
}

export function PageHeader({ title, count, subtitle, children }: { title: string; count?: ReactNode; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/**
 * Whether to offer "Claim" on a list row. This mirrors the server policy only to decide which
 * button to show; the server re-checks (and resolves races) when it is clicked.
 */
export function canClaimRow(me: Me | undefined, item: Pick<ListItem, 'team_id' | 'assignee_id' | 'status'>): boolean {
  if (!me || item.assignee_id || item.status === 'resolved' || item.status === 'closed') return false;
  if (me.isAdmin) return true;
  const role = me.teams.find((t) => t.id === item.team_id)?.role;
  return role === 'member' || role === 'lead';
}

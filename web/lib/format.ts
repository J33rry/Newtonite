import type { ItemType, Status, View, WorkflowAction } from './api';

export const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  pending_approval: 'Pending approval',
  in_progress: 'In progress',
  blocked: 'Blocked',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TYPE_LABEL: Record<ItemType, string> = {
  incident: 'Incident',
  customer_issue: 'Customer issue',
  engineering: 'Engineering',
  payment: 'Payment',
  compliance: 'Compliance',
  task: 'Task',
};

export const PRIORITY_LABEL: Record<number, string> = { 1: 'P1 Critical', 2: 'P2 High', 3: 'P3 Normal', 4: 'P4 Low' };

export const ACTION_LABEL: Record<WorkflowAction, string> = {
  submit_for_approval: 'Request approval',
  approve: 'Approve',
  reject: 'Reject',
  start: 'Start work',
  block: 'Mark blocked',
  unblock: 'Unblock',
  resolve: 'Resolve',
  close: 'Close',
  reopen: 'Reopen',
};

export const VIEW_LABEL: Record<View, string> = {
  all: 'All visible work',
  mine: 'Assigned to me',
  unassigned: 'Unassigned in my teams',
  approvals: 'Waiting for my approval',
  overdue: 'Overdue',
  stale: 'No activity recently',
  requested: 'Requested by me',
};

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [number, string][] = [
    [365 * 86_400_000, 'y'],
    [30 * 86_400_000, 'mo'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return future ? `in ${n}${label}` : `${n}${label} ago`;
    }
  }
  return 'just now';
}

export function absoluteTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

export const isOverdue = (dueAt: string | null, status: Status) =>
  !!dueAt && new Date(dueAt).getTime() < Date.now() && status !== 'resolved' && status !== 'closed';

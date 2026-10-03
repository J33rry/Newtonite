import type { Status, WorkItem } from './types.js';

/**
 * The workflow is expressed as named actions rather than "set status to X", so every rule lives in
 * one place and clients cannot jump states (e.g. open -> resolved, or skip an approval).
 *
 *   open ──start──► in_progress ──resolve──► resolved ──close──► closed
 *    │                 │   ▲                    │                   │
 *    │            block│   │unblock             └──────reopen───────┴──► open
 *    │                 ▼   │
 *    │               blocked
 *    └─submit_for_approval─► pending_approval ──approve──► open / in_progress
 *                                     └──reject──► closed
 */
export const ACTIONS = ['submit_for_approval', 'approve', 'reject', 'start', 'block', 'unblock', 'resolve', 'close', 'reopen'] as const;
export type WorkflowAction = (typeof ACTIONS)[number];

export const REASON_REQUIRED: ReadonlySet<WorkflowAction> = new Set(['reject', 'block', 'reopen']);

type ItemState = Pick<WorkItem, 'status' | 'assignee_id' | 'requires_approval' | 'approved_by'>;

export type TransitionResult =
  | { ok: true; to: Status; approve?: boolean; clearApproval?: boolean }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): TransitionResult => ({ ok: false, code, message });

export function needsApproval(item: ItemState): boolean {
  return item.requires_approval && !item.approved_by;
}

export function transition(item: ItemState, action: WorkflowAction, reason?: string): TransitionResult {
  if (REASON_REQUIRED.has(action) && !reason?.trim()) {
    return fail('REASON_REQUIRED', `A reason is required to ${action} an item`);
  }
  const from = item.status;
  const invalid = () => fail('INVALID_TRANSITION', `Cannot ${action.replace(/_/g, ' ')} an item that is ${from.replace(/_/g, ' ')}`);

  switch (action) {
    case 'submit_for_approval':
      if (from !== 'open') return invalid();
      if (!item.requires_approval) return fail('APPROVAL_NOT_REQUIRED', 'This item does not require approval');
      if (item.approved_by) return fail('ALREADY_APPROVED', 'This item is already approved');
      return { ok: true, to: 'pending_approval' };
    case 'approve':
      if (from !== 'pending_approval') return invalid();
      return { ok: true, to: item.assignee_id ? 'in_progress' : 'open', approve: true };
    case 'reject':
      if (from !== 'pending_approval') return invalid();
      return { ok: true, to: 'closed' };
    case 'start':
      if (from !== 'open') return invalid();
      if (!item.assignee_id) return fail('ASSIGNEE_REQUIRED', 'Assign the item before starting work');
      if (needsApproval(item)) return fail('APPROVAL_REQUIRED', 'This item must be approved before work can start');
      return { ok: true, to: 'in_progress' };
    case 'block':
      if (from !== 'in_progress') return invalid();
      return { ok: true, to: 'blocked' };
    case 'unblock':
      if (from !== 'blocked') return invalid();
      return { ok: true, to: 'in_progress' };
    case 'resolve':
      if (from !== 'in_progress') return invalid();
      if (!item.assignee_id) return fail('ASSIGNEE_REQUIRED', 'An item must have an owner to be resolved');
      if (needsApproval(item)) return fail('APPROVAL_REQUIRED', 'This item must be approved before it can be resolved');
      return { ok: true, to: 'resolved' };
    case 'close':
      if (from !== 'resolved') return invalid();
      return { ok: true, to: 'closed' };
    case 'reopen':
      if (from !== 'resolved' && from !== 'closed') return invalid();
      return { ok: true, to: 'open' };
  }
}

/** Status after an ownership change. Claiming starts work when allowed; losing the owner returns active work to the queue. */
export function statusAfterAssignment(item: ItemState, newAssignee: string | null, autoStart: boolean): Status {
  if (newAssignee === null && (item.status === 'in_progress' || item.status === 'blocked')) return 'open';
  if (newAssignee && autoStart && item.status === 'open' && !needsApproval(item)) return 'in_progress';
  return item.status;
}

export function canBeAssigned(item: ItemState): boolean {
  return item.status !== 'resolved' && item.status !== 'closed';
}

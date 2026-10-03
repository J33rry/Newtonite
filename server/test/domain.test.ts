import { describe, expect, it } from 'vitest';
import { authorize, canView } from '../src/domain/policy.js';
import type { Actor, Role } from '../src/domain/types.js';
import { statusAfterAssignment, transition } from '../src/domain/workflow.js';

const TEAM = 'team-1';
const actor = (id: string, role?: Role, isAdmin = false): Actor => ({
  id, name: id, isAdmin, roles: new Map(role ? [[TEAM, role]] : []),
});
const item = (over: Partial<{ team_id: string; created_by: string; assignee_id: string | null }> = {}) => ({
  team_id: TEAM, created_by: 'requester', assignee_id: null, ...over,
});
const state = (over: Record<string, unknown> = {}) => ({
  status: 'open' as const, assignee_id: null as string | null, requires_approval: false, approved_by: null as string | null, ...over,
});

describe('workflow rules', () => {
  it('cannot skip straight from open to resolved', () => {
    expect(transition(state({ assignee_id: 'u' }), 'resolve')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
  });

  it('cannot start work without an owner', () => {
    expect(transition(state(), 'start')).toMatchObject({ ok: false, code: 'ASSIGNEE_REQUIRED' });
  });

  it('cannot start or resolve an approval-gated item before approval', () => {
    const gated = state({ requires_approval: true, assignee_id: 'u' });
    expect(transition(gated, 'start')).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    expect(transition({ ...gated, status: 'in_progress' }, 'resolve')).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    expect(transition({ ...gated, approved_by: 'lead' }, 'start')).toMatchObject({ ok: true, to: 'in_progress' });
  });

  it('approval returns the item to the owner if it has one', () => {
    expect(transition(state({ status: 'pending_approval', requires_approval: true }), 'approve')).toMatchObject({ ok: true, to: 'open', approve: true });
    expect(transition(state({ status: 'pending_approval', requires_approval: true, assignee_id: 'u' }), 'approve')).toMatchObject({ ok: true, to: 'in_progress' });
  });

  it('requires a reason for reject, block and reopen', () => {
    expect(transition(state({ status: 'pending_approval' }), 'reject')).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(transition(state({ status: 'in_progress' }), 'block', '  ')).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(transition(state({ status: 'closed' }), 'reopen', 'customer replied')).toMatchObject({ ok: true, to: 'open' });
  });

  it('releasing an active item returns it to the queue; claiming starts it only when approved', () => {
    expect(statusAfterAssignment(state({ status: 'in_progress', assignee_id: 'u' }), null, false)).toBe('open');
    expect(statusAfterAssignment(state(), 'u', true)).toBe('in_progress');
    expect(statusAfterAssignment(state({ requires_approval: true }), 'u', true)).toBe('open');
  });
});

describe('authorization policy', () => {
  it('hides items of other teams, except from their requester and owner', () => {
    expect(canView(actor('x'), item())).toBe(false);
    expect(canView(actor('requester'), item())).toBe(true);
    expect(canView(actor('x'), item({ assignee_id: 'x' }))).toBe(true);
    expect(canView(actor('x', 'viewer'), item())).toBe(true);
  });

  it('viewers can comment but not take ownership', () => {
    expect(authorize(actor('v', 'viewer'), 'comment', item()).allowed).toBe(true);
    expect(authorize(actor('v', 'viewer'), 'claim', item()).allowed).toBe(false);
    expect(authorize(actor('m', 'member'), 'claim', item()).allowed).toBe(true);
  });

  it('only leads change priority or reassign', () => {
    expect(authorize(actor('m', 'member'), 'change_priority', item()).allowed).toBe(false);
    expect(authorize(actor('m', 'member'), 'assign', item()).allowed).toBe(false);
    expect(authorize(actor('l', 'lead'), 'assign', item()).allowed).toBe(true);
  });

  it('a member cannot resolve someone else’s item; the owner can', () => {
    expect(authorize(actor('m', 'member'), 'workflow:resolve', item({ assignee_id: 'other' })).allowed).toBe(false);
    expect(authorize(actor('m', 'member'), 'workflow:resolve', item({ assignee_id: 'm' })).allowed).toBe(true);
  });

  it('enforces segregation of duties on approvals, even for admins', () => {
    expect(authorize(actor('l', 'lead'), 'workflow:approve', item()).allowed).toBe(true);
    expect(authorize(actor('l', 'lead'), 'workflow:approve', item({ created_by: 'l' })).allowed).toBe(false);
    expect(authorize(actor('l', 'lead'), 'workflow:approve', item({ assignee_id: 'l' })).allowed).toBe(false);
    expect(authorize(actor('admin', undefined, true), 'workflow:approve', item({ created_by: 'admin' })).allowed).toBe(false);
    expect(authorize(actor('m', 'member'), 'workflow:approve', item()).allowed).toBe(false);
  });

  it('a requester outside the team can view and close but not work the item', () => {
    const requester = actor('requester');
    expect(authorize(requester, 'comment', item()).allowed).toBe(true);
    expect(authorize(requester, 'workflow:close', item()).allowed).toBe(true);
    expect(authorize(requester, 'claim', item()).allowed).toBe(false);
  });
});

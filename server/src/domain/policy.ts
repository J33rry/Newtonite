import type { WorkflowAction } from './workflow.js';
import type { Actor, Role, WorkItem } from './types.js';

/**
 * Resource-level authorization. Every check takes the actor AND the specific item, because
 * permissions depend on the item's team and on the actor's relationship to it (creator, assignee).
 *
 * Roles are per team: viewer < member < lead. Global admins act as a lead in every team.
 * Requesters keep visibility of items they raised even if they are not in the owning team.
 */
export type ItemPermission =
  | 'view'
  | 'comment'
  | 'edit'
  | 'change_priority'
  | 'claim'
  | 'assign'
  | 'release'
  | 'transfer'
  | `workflow:${WorkflowAction}`;

type ItemRef = Pick<WorkItem, 'team_id' | 'created_by' | 'assignee_id'>;

const RANK: Record<Role, number> = { viewer: 1, member: 2, lead: 3 };

export function roleIn(actor: Actor, teamId: string): Role | null {
  if (actor.isAdmin) return 'lead';
  return actor.roles.get(teamId) ?? null;
}

export function hasRole(actor: Actor, teamId: string, min: Role): boolean {
  const role = roleIn(actor, teamId);
  return role !== null && RANK[role] >= RANK[min];
}

export function canView(actor: Actor, item: ItemRef): boolean {
  return hasRole(actor, item.team_id, 'viewer') || item.created_by === actor.id || item.assignee_id === actor.id;
}

export type Decision = { allowed: true } | { allowed: false; reason: string };
const allow: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

export function authorize(actor: Actor, permission: ItemPermission, item: ItemRef): Decision {
  if (!canView(actor, item)) return deny('You do not have access to this item');

  const isLead = hasRole(actor, item.team_id, 'lead');
  const isMember = hasRole(actor, item.team_id, 'member');
  const isAssignee = item.assignee_id === actor.id;
  const isCreator = item.created_by === actor.id;

  switch (permission) {
    case 'view':
    case 'comment':
      return allow;
    case 'edit':
      return isLead || isAssignee || isCreator ? allow : deny('Only the owner, the requester or a team lead can edit this item');
    case 'change_priority':
    case 'assign':
    case 'transfer':
      return isLead ? allow : deny('Only a team lead can do this');
    case 'claim':
      return isMember ? allow : deny('Only team members can take ownership of this item');
    case 'release':
      return isAssignee || isLead ? allow : deny('Only the current owner or a team lead can release this item');
    case 'workflow:start':
    case 'workflow:block':
    case 'workflow:unblock':
    case 'workflow:resolve':
      return isAssignee || isLead ? allow : deny('Only the current owner or a team lead can do this');
    case 'workflow:submit_for_approval':
      return isAssignee || isCreator || isMember ? allow : deny('You cannot submit this item for approval');
    case 'workflow:approve':
    case 'workflow:reject':
      if (!isLead) return deny('Only a team lead can approve or reject');
      // Segregation of duties: the person asking for, or doing, the work cannot approve it.
      if (isCreator || isAssignee) return deny('You cannot approve an item you requested or own');
      return allow;
    case 'workflow:close':
      return isLead || isCreator ? allow : deny('Only the requester or a team lead can close this item');
    case 'workflow:reopen':
      return isMember || isCreator ? allow : deny('Only team members or the requester can reopen this item');
  }
}

/** Every permission, evaluated for one item — sent to the UI so it can show only usable controls. */
export function permissionsFor(actor: Actor, item: ItemRef): Record<string, boolean> {
  const all: ItemPermission[] = [
    'comment', 'edit', 'change_priority', 'claim', 'assign', 'release', 'transfer',
    'workflow:submit_for_approval', 'workflow:approve', 'workflow:reject', 'workflow:start', 'workflow:block',
    'workflow:unblock', 'workflow:resolve', 'workflow:close', 'workflow:reopen',
  ];
  return Object.fromEntries(all.map((p) => [p, authorize(actor, p, item).allowed]));
}

/**
 * Thin typed client for the Fastify API. Every non-2xx response becomes an ApiError carrying the
 * server's machine-readable `code`, which the UI switches on (VERSION_CONFLICT, ALREADY_CLAIMED, …).
 */

export type Status = 'open' | 'pending_approval' | 'in_progress' | 'blocked' | 'resolved' | 'closed';
export type ItemType = 'incident' | 'customer_issue' | 'engineering' | 'payment' | 'compliance' | 'task';
export type WorkflowAction = 'submit_for_approval' | 'approve' | 'reject' | 'start' | 'block' | 'unblock' | 'resolve' | 'close' | 'reopen';
export type View = 'all' | 'mine' | 'unassigned' | 'approvals' | 'overdue' | 'stale' | 'requested';

export interface ListItem {
  id: string;
  number: number;
  title: string;
  type: ItemType;
  priority: number;
  status: Status;
  team_id: string;
  team_name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  due_at: string | null;
  updated_at: string;
  last_activity_at: string;
  requires_approval: boolean;
  approved: boolean;
  version: number;
}

export interface ItemDetail extends Omit<ListItem, 'approved'> {
  description: string;
  created_by: string;
  created_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  resolved_at: string | null;
  watching: boolean;
  watcher_count: number;
  permissions: Record<string, boolean>;
  actions: WorkflowAction[];
  canClaim: boolean;
}

export interface ItemEvent {
  id: number;
  type: 'created' | 'updated' | 'assigned' | 'status_changed' | 'transferred' | 'commented';
  data: Record<string, any>;
  version: number | null;
  created_at: string;
  actor_id: string;
  actor_name: string;
  from_name: string | null;
  to_name: string | null;
}

export interface Me {
  id: string;
  name: string;
  isAdmin: boolean;
  teams: { id: string; name: string; slug: string; role: 'viewer' | 'member' | 'lead' }[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
}

export interface Notification {
  id: number;
  kind: string;
  message: string;
  item_id: string | null;
  item_number: number | null;
  read_at: string | null;
  created_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, any>,
  ) {
    super(message);
  }
  /** Worth retrying automatically (with the same idempotency key). */
  get retryable() {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string; json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.idempotencyKey) headers.set('idempotency-key', init.idempotencyKey);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

export const newIdempotencyKey = () => crypto.randomUUID();

export function toQueryString(params: Record<string, string | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

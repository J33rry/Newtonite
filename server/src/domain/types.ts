import type { workItems } from '../db/schema.js';
import { ITEM_TYPES, ROLES, STATUSES } from '../db/schema.js';

export { ITEM_TYPES, ROLES, STATUSES };
export type ItemType = (typeof ITEM_TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type Role = (typeof ROLES)[number];
export const TERMINAL_STATUSES: readonly Status[] = ['resolved', 'closed'];

export interface Actor {
  id: string;
  name: string;
  isAdmin: boolean;
  /** team_id -> role */
  roles: Map<string, Role>;
}

/** A work_items row as the domain layer sees it (derived from the schema; internal columns omitted). */
export type WorkItem = Omit<typeof workItems.$inferSelect, 'search' | 'overdue_alerted_for'>;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Item') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message: string) => new AppError(403, 'FORBIDDEN', message);

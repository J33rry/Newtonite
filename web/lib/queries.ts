'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, newIdempotencyKey, request, toQueryString, type ItemDetail, type ItemEvent, type ListItem, type Me, type Notification, type Team, type View } from './api';
import { useToast } from '@/components/Toast';

/**
 * Frontend state strategy:
 *  * Server state lives only in the TanStack Query cache (keys below), never copied into component state.
 *  * List filters live in the URL, so views are shareable and the back button works.
 *  * Realtime events invalidate cache entries (see realtime.ts); the API remains the source of truth.
 */
export const keys = {
  me: ['me'] as const,
  teams: ['teams'] as const,
  members: (teamId: string) => ['members', teamId] as const,
  dashboard: ['dashboard'] as const,
  items: (filters: Record<string, string | undefined>) => ['items', filters] as const,
  item: (id: string) => ['item', id] as const,
  events: (id: string) => ['events', id] as const,
  notifications: ['notifications'] as const,
  insights: (days: number, team?: string) => ['insights', days, team ?? ''] as const,
  itemsPage: (filters: Record<string, string | undefined>, cursor: string | undefined, limit: number) => ['items', 'page', filters, cursor ?? '', limit] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => request<Me>('/api/me'), staleTime: 60_000, retry: false });
export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => request<{ teams: Team[] }>('/api/teams').then((r) => r.teams), staleTime: 300_000 });
export const useMembers = (teamId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.members(teamId ?? ''),
    queryFn: () => request<{ members: { id: string; name: string; role: string }[] }>(`/api/teams/${teamId}/members`).then((r) => r.members),
    enabled: !!teamId && enabled,
    staleTime: 60_000,
  });

export interface DashboardSection {
  view: View;
  count: number;
  capped: boolean;
  items: ListItem[];
}
export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => request<{ sections: DashboardSection[] }>('/api/dashboard') });

export interface ItemsPage {
  items: ListItem[];
  nextCursor: string | null;
  /** only present on the first page (no cursor); capped at 1000 */
  total: number | null;
  totalCapped: boolean;
}

/** One page of a keyset-paginated list. Previous pages are reached via the caller's cursor stack. */
export function useItemsPage(filters: Record<string, string | undefined>, cursor: string | undefined, limit: number) {
  return useQuery({
    queryKey: keys.itemsPage(filters, cursor, limit),
    queryFn: () => request<ItemsPage>(`/api/items${toQueryString({ ...filters, cursor, limit: String(limit) })}`),
    placeholderData: keepPreviousData,
  });
}

export interface KpiSeries {
  points: { date: string; value: number }[];
  current: number;
  previous: number;
}
export interface Insights {
  days: number;
  flow: { date: string; created: number; resolved: number }[];
  kpis: Record<'open' | 'mine' | 'unassigned' | 'overdue', KpiSeries>;
  byStatus: { status: string; count: number }[];
  byTeam: { teamId: string; team: string; p1: number; p2: number; p3: number; p4: number; total: number }[];
  resolution: { priority: number; resolved: number; median_hours: number | null; p90_hours: number | null }[];
  aging: { bucket: string; count: number }[];
}

const viewerTimeZone = () => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC') || 'UTC';

export const useInsights = (days: number, team?: string) =>
  useQuery({
    queryKey: keys.insights(days, team),
    queryFn: () => request<Insights>(`/api/insights${toQueryString({ days: String(days), team, tz: viewerTimeZone() })}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

/**
 * Claim straight from a list row. Same guarantees as the detail page: idempotency key per click,
 * automatic retry of network failures with that key, and the server's verdict shown on conflict.
 */
export function useClaim() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string; number: number }) =>
      request<ItemDetail>(`/api/items/${id}/claim`, { method: 'POST', idempotencyKey: key, json: {} }),
    retry: (count, err) => err instanceof ApiError && err.retryable && count < 3,
    onSuccess: (item, { number }) => {
      qc.setQueryData(keys.item(item.id), item);
      toast.show({ kind: 'success', title: `You own #${number} now` });
    },
    onError: (err) => {
      const e = err as ApiError;
      toast.show({ kind: e.code === 'ALREADY_CLAIMED' ? 'warning' : 'error', title: e.code === 'ALREADY_CLAIMED' ? 'Already taken' : 'Could not claim', body: e.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: keys.dashboard });
      qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
}

export const useItem = (id: string) => useQuery({ queryKey: keys.item(id), queryFn: () => request<ItemDetail>(`/api/items/${id}`), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });

export function useEvents(id: string) {
  return useInfiniteQuery({
    queryKey: keys.events(id),
    queryFn: ({ pageParam }) =>
      request<{ events: ItemEvent[]; nextBefore: number | null }>(`/api/items/${id}/events${toQueryString({ before: pageParam?.toString() })}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: () => request<{ notifications: Notification[]; unread: number }>('/api/notifications') });

// -------------------------------------------------------------------------------------------
// Mutations
// -------------------------------------------------------------------------------------------

interface ItemMutationOptions<V> {
  /** Performs the request. `key` is the idempotency key for this user intent. */
  request: (vars: V, key: string) => Promise<ItemDetail>;
  /** Optional optimistic update applied immediately; rolled back if the server says no. */
  optimistic?: (item: ItemDetail, vars: V) => ItemDetail;
  success?: string | ((item: ItemDetail) => string);
  /** Called on a version conflict, after the latest item has been fetched. */
  onConflict?: (vars: V) => void;
  onSuccess?: (item: ItemDetail) => void;
}

/**
 * Item mutations share one lifecycle:
 *   1. one idempotency key per user intent; automatic retries of network failures reuse it, so a
 *      retried "resolve" cannot be applied twice;
 *   2. optional optimistic cache update for instant feedback;
 *   3. on success, the cache is replaced with the server's item (server decision wins);
 *   4. on failure, the optimistic change is rolled back and the server's reason is shown; on a
 *      version conflict the latest item is fetched so the user sees what changed.
 */
export function useItemMutation<V>(id: string, opts: ItemMutationOptions<V>) {
  const qc = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: ({ vars, key }: { vars: V; key: string }) => opts.request(vars, key),
    retry: (count, err) => err instanceof ApiError && err.retryable && count < 3,
    retryDelay: (attempt) => 400 * 2 ** attempt,
    onMutate: async ({ vars }) => {
      await qc.cancelQueries({ queryKey: keys.item(id) });
      const previous = qc.getQueryData<ItemDetail>(keys.item(id));
      if (previous && opts.optimistic) qc.setQueryData(keys.item(id), opts.optimistic(previous, vars));
      return { previous };
    },
    onError: async (err, { vars }, context) => {
      if (context?.previous) qc.setQueryData(keys.item(id), context.previous);
      const e = err as ApiError;
      if (e.code === 'VERSION_CONFLICT') {
        await qc.invalidateQueries({ queryKey: keys.item(id) });
        toast.show({ kind: 'warning', title: 'Someone else changed this item', body: 'You are now seeing the latest version. Review it and try again.' });
        opts.onConflict?.(vars);
      } else if (e.code === 'ALREADY_CLAIMED') {
        await qc.invalidateQueries({ queryKey: keys.item(id) });
        toast.show({ kind: 'warning', title: 'Already taken', body: e.message });
      } else {
        if (e.status === 404 || e.status === 403) qc.invalidateQueries({ queryKey: keys.item(id) });
        toast.show({ kind: 'error', title: 'Could not complete that', body: e.message });
      }
    },
    onSuccess: (item) => {
      if (item && 'id' in item && 'version' in item) qc.setQueryData(keys.item(id), item);
      opts.onSuccess?.(item);
      if (opts.success) toast.show({ kind: 'success', title: typeof opts.success === 'function' ? opts.success(item) : opts.success });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.events(id) });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: keys.dashboard });
      qc.invalidateQueries({ queryKey: ['insights'] });
    },
  });
  return {
    run: (vars: V) => mutation.mutate({ vars, key: newIdempotencyKey() }),
    isPending: mutation.isPending,
    error: mutation.error as ApiError | null,
    reset: mutation.reset,
  };
}

'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type InvalidateQueryFilters, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ItemDetail } from './api';
import { keys } from './queries';

type ConnectionState = 'connecting' | 'live' | 'offline';
let state: ConnectionState = 'connecting';
const listeners = new Set<() => void>();
const setState = (s: ConnectionState) => {
  state = s;
  listeners.forEach((l) => l());
};
export const useConnectionState = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state, () => 'connecting' as ConnectionState);

/**
 * Refetch strategy for change events. With thousands of open tabs, every event fans out to every
 * viewer, so how each tab reacts decides the load on the API:
 *  * scoped: a list filtered to another team is left alone;
 *  * coalesced: bursts collapse into one refetch per window, which is also randomly delayed (jitter)
 *    so thousands of tabs do not hit the API in the same millisecond;
 *  * lazy in the background: a hidden tab only marks data stale and refetches when it is focused again;
 *  * insights are not driven by events at all (daily trends; they poll once a minute while on screen).
 */
const LIST_WINDOW_MS = 3000;
const JITTER_MS = 2000;

/** Active queries refetch now; in a hidden tab they are only marked stale (refetched on focus). */
function invalidate(qc: QueryClient, filters: InvalidateQueryFilters) {
  return qc.invalidateQueries({ ...filters, refetchType: document.hidden ? 'none' : 'active' });
}

/** The filters object inside a list query key: ['items', filters] or ['items', 'page', filters, …]. */
function listFilters(key: QueryKey): Record<string, string | undefined> | undefined {
  return key.find((part): part is Record<string, string | undefined> => typeof part === 'object' && part !== null);
}

/** Accumulates which teams changed during a window, then refreshes only the lists that can show them. */
function listRefresher(qc: QueryClient) {
  let teams = new Set<string>();
  let everything = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const changed = teams;
    const all = everything;
    teams = new Set();
    everything = false;
    timer = null;
    invalidate(qc, {
      queryKey: ['items'],
      predicate: (q) => {
        const team = listFilters(q.queryKey)?.team;
        return all || !team || changed.has(team);
      },
    });
    invalidate(qc, { queryKey: keys.dashboard });
  };

  return {
    /** `teamId` undefined = the change may affect any team (e.g. a transfer between teams). */
    add(teamId: string | undefined) {
      if (teamId) teams.add(teamId);
      else everything = true;
      timer ??= setTimeout(flush, LIST_WINDOW_MS + Math.random() * JITTER_MS);
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  };
}

function handleItemEvent(
  qc: QueryClient,
  msg: { itemId: string; teamId: string; version: number; eventType: string },
  lists: ReturnType<typeof listRefresher>,
) {
  const cached = qc.getQueryData<ItemDetail>(keys.item(msg.itemId));
  // Only refetch an open item if the event is newer than what we hold (our own mutation's echo is skipped).
  if (cached && (cached.version < msg.version || msg.eventType === 'commented')) {
    invalidate(qc, { queryKey: keys.item(msg.itemId) });
  }
  invalidate(qc, { queryKey: keys.events(msg.itemId) });
  // A transfer removes the item from its old team's lists, and the message only names the new team.
  lists.add(msg.eventType === 'transferred' ? undefined : msg.teamId);
}

/**
 * Subscribes to /api/stream (Server-Sent Events). Messages contain ids and versions only; data is
 * always refetched through the authorized API. On reconnect we refetch everything we show, since
 * messages sent while disconnected are not replayed.
 */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const lists = listRefresher(qc);
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let firstConnect = true;

    const connect = () => {
      setState('connecting');
      source = new EventSource('/api/stream');
      source.addEventListener('ready', () => {
        setState('live');
        if (!firstConnect) invalidate(qc, {}); // resync after a gap
        firstConnect = false;
      });
      source.addEventListener('resync', () => invalidate(qc, {}));
      source.addEventListener('item', (e) => handleItemEvent(qc, JSON.parse((e as MessageEvent).data), lists));
      source.addEventListener('notification', () => invalidate(qc, { queryKey: keys.notifications }));
      source.onerror = () => {
        setState('offline');
        // EventSource retries by itself, but not after fatal errors (e.g. 401); reconnect manually.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          retry = setTimeout(connect, 5000);
        }
      };
    };
    connect();
    return () => {
      source?.close();
      lists.cancel();
      if (retry) clearTimeout(retry);
    };
  }, [enabled, qc]);
}

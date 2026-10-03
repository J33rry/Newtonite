'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
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

/** Collapses bursts of list changes into one refetch, so busy periods do not cause refetch storms. */
function throttle(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}

function handleItemEvent(qc: QueryClient, msg: { itemId: string; version: number; eventType: string }, refreshLists: () => void) {
  const cached = qc.getQueryData<ItemDetail>(keys.item(msg.itemId));
  // Only refetch an open item if the event is newer than what we hold (our own mutation's echo is skipped).
  if (cached && (cached.version < msg.version || msg.eventType === 'commented')) {
    qc.invalidateQueries({ queryKey: keys.item(msg.itemId) });
  }
  qc.invalidateQueries({ queryKey: keys.events(msg.itemId) });
  refreshLists();
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
    const refreshLists = throttle(() => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: keys.dashboard });
      qc.invalidateQueries({ queryKey: ['insights'] });
    }, 3000);
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let firstConnect = true;

    const connect = () => {
      setState('connecting');
      source = new EventSource('/api/stream');
      source.addEventListener('ready', () => {
        setState('live');
        if (!firstConnect) qc.invalidateQueries(); // resync after a gap
        firstConnect = false;
      });
      source.addEventListener('resync', () => qc.invalidateQueries());
      source.addEventListener('item', (e) => handleItemEvent(qc, JSON.parse((e as MessageEvent).data), refreshLists));
      source.addEventListener('notification', () => qc.invalidateQueries({ queryKey: keys.notifications }));
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
      if (retry) clearTimeout(retry);
    };
  }, [enabled, qc]);
}

'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { WorkTable } from '@/components/WorkTable';
import { PageHeader } from '@/components/ui';
import type { ItemType, Status, View } from '@/lib/api';
import { STATUS_LABEL, TYPE_LABEL, VIEW_LABEL } from '@/lib/format';
import { useItemsPage, useTeams } from '@/lib/queries';

const FILTER_KEYS = ['view', 'team', 'status', 'priority', 'type', 'assignee', 'q', 'sort'] as const;

const VIEW_COPY: Record<View, { title: string; subtitle: string }> = {
  all: { title: 'All work', subtitle: 'Find, filter, and track all incidents, customer issues, engineering problems, and tasks.' },
  mine: { title: 'My work', subtitle: 'Active work you own, highest priority first.' },
  unassigned: { title: 'Team queue', subtitle: 'Unowned work in your teams. Claim something to start on it.' },
  approvals: { title: 'Approvals', subtitle: 'Requests waiting for a decision you are allowed to make.' },
  overdue: { title: 'Overdue', subtitle: 'Active work past its due date.' },
  stale: { title: 'Gone quiet', subtitle: 'In progress or blocked, with no activity for 3+ days.' },
  requested: { title: 'My requests', subtitle: 'Everything you have raised, wherever it is now.' },
};

export default function ItemsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ItemsList />
    </Suspense>
  );
}

/**
 * Filters live in the URL (shareable, back-button friendly). Paging is keyset-based on the server;
 * the page keeps a stack of cursors so "previous" is just popping back to the cursor before.
 */
function ItemsList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const teams = useTeams();
  const filters = useMemo(() => {
    const f: Record<string, string | undefined> = {};
    for (const k of FILTER_KEYS) f[k] = params.get(k) ?? undefined;
    return f;
  }, [params]);
  const filterKey = JSON.stringify(filters);
  const view = (filters.view as View) ?? 'all';

  const [limit, setLimit] = useState(25);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length - 1;
  // Any filter or page-size change restarts paging from the first page.
  useEffect(() => setCursors([undefined]), [filterKey, limit]);

  const { data, isLoading, isFetching, isPlaceholderData, error } = useItemsPage(filters, cursors[page], limit);
  // The total arrives with the first page only; remember it while paging through the same filters.
  const [total, setTotal] = useState<{ key: string; total: number; capped: boolean } | null>(null);
  useEffect(() => {
    if (data && data.total !== null && !isPlaceholderData) setTotal({ key: filterKey + limit, total: data.total, capped: data.totalCapped });
  }, [data, isPlaceholderData, filterKey, limit]);
  const known = total?.key === filterKey + limit ? total : null;

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  // Debounced search-as-you-type, synced to the URL.
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    if ((filters.q ?? '') === q) return;
    const t = setTimeout(() => setFilter('q', q.trim() || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggleCsv = (key: 'status' | 'priority' | 'type', value: string) => {
    const set = new Set((filters[key] ?? '').split(',').filter(Boolean));
    if (set.has(value)) set.delete(value);
    else set.add(value);
    setFilter(key, [...set].join(',') || undefined);
  };
  const csvHas = (key: 'status' | 'priority' | 'type', value: string) => (filters[key] ?? '').split(',').includes(value);
  const active = FILTER_KEYS.some((k) => k !== 'sort' && k !== 'view' && filters[k]);

  const items = data?.items ?? [];
  const from = page * limit + 1;
  const to = page * limit + items.length;
  const totalLabel = known ? `${known.total.toLocaleString()}${known.capped ? '+' : ''}` : '…';

  return (
    <div>
      <PageHeader title={VIEW_COPY[view]?.title ?? 'Work'} count={known ? `${totalLabel} ${known.total === 1 && !known.capped ? 'item' : 'items'}` : undefined} subtitle={VIEW_COPY[view]?.subtitle} />

      <section className="card filters-card">
        <div className="filter-row">
          <div className="search">
            <Search size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search problems, tasks, or #number…" aria-label="Search" />
          </div>
          <select value={filters.team ?? ''} onChange={(e) => setFilter('team', e.target.value || undefined)} aria-label="Team">
            <option value="">All teams</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select value={filters.assignee ?? ''} onChange={(e) => setFilter('assignee', e.target.value || undefined)} aria-label="Owner">
            <option value="">Any owner</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
          </select>
          <select value={view} onChange={(e) => setFilter('view', e.target.value === 'all' ? undefined : e.target.value)} aria-label="View">
            {Object.entries(VIEW_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {v === 'all' ? 'All work' : label}
              </option>
            ))}
          </select>
          <select value={filters.sort ?? 'priority'} onChange={(e) => setFilter('sort', e.target.value === 'priority' ? undefined : e.target.value)} aria-label="Sort">
            <option value="priority">Sort: priority</option>
            <option value="recent">Sort: recently updated</option>
          </select>
        </div>
        <div className="chips">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button key={s} className={`chip ${csvHas('status', s) ? 'on' : ''}`} onClick={() => toggleCsv('status', s)} aria-pressed={csvHas('status', s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
          <span className="chip-sep" />
          {[1, 2, 3, 4].map((p) => (
            <button key={p} className={`chip ${csvHas('priority', String(p)) ? 'on' : ''}`} onClick={() => toggleCsv('priority', String(p))} aria-pressed={csvHas('priority', String(p))}>
              P{p}
            </button>
          ))}
          <span className="chip-sep" />
          {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
            <button key={t} className={`chip ${csvHas('type', t) ? 'on' : ''}`} onClick={() => toggleCsv('type', t)} aria-pressed={csvHas('type', t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
          {active && (
            <button className="link" onClick={() => router.replace(view === 'all' ? pathname : `${pathname}?view=${view}`)}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      {error && <div className="alert alert-error">{(error as Error).message}</div>}

      <section className={`card ${isPlaceholderData ? 'dim' : ''}`}>
        {isLoading ? (
          <div className="card-pad"><div className="skeleton" style={{ height: 320 }} /></div>
        ) : (
          <WorkTable items={items} columns={['priority', 'title', 'status', 'owner', 'team', 'updated', 'actions']} />
        )}
        <footer className="table-foot">
          <label className="actions muted small">
            Rows per page
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows per page">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="pager">
            <span className="muted small tabular">
              {items.length ? `${from.toLocaleString()}–${to.toLocaleString()} of ${totalLabel}` : '0 results'}
              {isFetching && !isLoading ? ' · updating…' : ''}
            </span>
            <button className="btn btn-icon btn-sm" disabled={page === 0} onClick={() => setCursors((c) => c.slice(0, -1))} aria-label="Previous page">
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-icon btn-sm btn-outline" disabled={!data?.nextCursor || isPlaceholderData}
              onClick={() => data?.nextCursor && setCursors((c) => [...c, data.nextCursor!])} aria-label="Next page">
              <ChevronRight size={18} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

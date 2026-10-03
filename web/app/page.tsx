'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, ChevronRight, Clock3, ClipboardList, UserRound, Users } from 'lucide-react';
import { ChartCard, FLOW_SERIES, FlowChart, Legend, Sparkline, StatusDonut } from '@/components/charts/Charts';
import { SERIES, shortDate, STATUS_ORDER } from '@/components/charts/theme';
import { WorkTable } from '@/components/WorkTable';
import { PageHeader, StatusPill } from '@/components/ui';
import { isOverdue, relativeTime, STATUS_LABEL } from '@/lib/format';
import { useDashboard, useInsights, useItemsPage, useMe, type KpiSeries } from '@/lib/queries';

const RANGES = [7, 14, 30] as const;
const ACTIVE = 'open,pending_approval,in_progress,blocked';

const KPI_CARDS = [
  { metric: 'open', label: 'Open work', icon: ClipboardList, color: SERIES.blue, tint: '#e8f0fe', href: `/items?status=${ACTIVE}` },
  { metric: 'mine', label: 'Assigned to me', icon: UserRound, color: SERIES.aqua, tint: '#e1f5ec', href: '/items?view=mine' },
  { metric: 'unassigned', label: 'Unassigned', icon: Users, color: SERIES.violet, tint: '#ece9fb', href: '/items?view=unassigned' },
  { metric: 'overdue', label: 'Overdue', icon: Clock3, color: SERIES.red, tint: '#fde6e5', href: '/items?view=overdue' },
] as const;

export default function OverviewPage() {
  const me = useMe();
  const [days, setDays] = useState<number>(7);
  const [team, setTeam] = useState<string>('');
  const insights = useInsights(days, team || undefined);
  const dashboard = useDashboard();
  const queue = useItemsPage({ status: ACTIVE, sort: 'priority', team: team || undefined }, undefined, 6);
  const myTasks = dashboard.data?.sections.find((s) => s.view === 'mine');
  const d = insights.data;
  const activeTotal = d?.byStatus.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <div className={insights.isPlaceholderData ? 'dim' : ''}>
      <PageHeader title="Operations overview" subtitle="Team workload and service health">
        {me.data && me.data.teams.length > 1 && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
            <option value="">All my teams</option>
            {me.data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label className="relative" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <CalendarDays size={16} style={{ position: 'absolute', left: 12, color: 'var(--ink-2)', pointerEvents: 'none' }} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range" style={{ paddingLeft: 36 }}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                Last {r} days
              </option>
            ))}
          </select>
        </label>
      </PageHeader>

      {insights.error && <div className="alert alert-error">Could not load metrics: {(insights.error as Error).message}</div>}

      <div className="kpis">
        {KPI_CARDS.map((k) => (
          <KpiCard key={k.metric} {...k} series={d?.kpis[k.metric]} days={days} />
        ))}
      </div>

      <div className="overview-grid">
        <ChartCard
          title="Operational health"
          subtitle={`Work created vs resolved over the last ${days} days`}
          legend={<Legend items={FLOW_SERIES.map((s) => ({ color: s.color, label: s.label }))} />}
          table={{ columns: ['Date', 'Created', 'Resolved'], rows: (d?.flow ?? []).map((r) => [shortDate(r.date), r.created, r.resolved]) }}
          height={250}
        >
          {d ? <FlowChart data={d.flow} /> : <div className="skeleton" style={{ height: '100%' }} />}
        </ChartCard>

        <ChartCard
          title="Work by status"
          subtitle="Current state of active work"
          table={{
            columns: ['Status', 'Items', 'Share'],
            rows: STATUS_ORDER.map((s) => {
              const n = d?.byStatus.find((r) => r.status === s)?.count ?? 0;
              return [STATUS_LABEL[s], n, `${activeTotal ? Math.round((n / activeTotal) * 100) : 0}%`];
            }),
          }}
          height={250}
        >
          {d ? <StatusDonut data={d.byStatus} total={activeTotal} /> : <div className="skeleton" style={{ height: 170 }} />}
        </ChartCard>

        <section className="card card-pad">
          <header className="card-head">
            <h2>My pending tasks</h2>
            <Link href="/items?view=mine" className="link small">
              View all <ArrowRight size={15} />
            </Link>
          </header>
          {!myTasks?.items.length ? (
            <p className="empty">{dashboard.isLoading ? 'Loading…' : 'Nothing assigned to you.'}</p>
          ) : (
            <ul className="task-list">
              {myTasks.items.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <Link href={`/items/${t.id}`} className="task">
                    <span className={`prio prio-dot prio-${t.priority}`}>P{t.priority}</span>
                    <span className="task-body">
                      <span className="task-title" style={{ display: 'block' }}>{t.title}</span>
                      <span className="task-meta">
                        {t.team_name} · #{t.number}
                      </span>
                    </span>
                    {isOverdue(t.due_at, t.status) ? (
                      <span className="pill status-blocked">Overdue {relativeTime(t.due_at)}</span>
                    ) : (
                      <StatusPill status={t.status} />
                    )}
                    <ChevronRight size={18} className="faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <header className="card-head card-pad" style={{ marginBottom: 0, paddingBottom: 14 }}>
          <div>
            <h2>Team queue</h2>
            <p>Highest-priority active work you can see</p>
          </div>
          <Link href={`/items?status=${ACTIVE}`} className="link small">
            View all <ArrowRight size={15} />
          </Link>
        </header>
        {queue.data ? (
          <WorkTable items={queue.data.items} columns={['priority', 'title', 'team', 'owner', 'status', 'due', 'actions']} />
        ) : (
          <div className="card-pad"><div className="skeleton" style={{ height: 200 }} /></div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label, icon: Icon, color, tint, href, series, days,
}: {
  metric: string;
  label: string;
  icon: typeof Users;
  color: string;
  tint: string;
  href: string;
  series?: KpiSeries;
  days: number;
}) {
  const delta = series && series.previous > 0 ? ((series.current - series.previous) / series.previous) * 100 : null;
  // For all four metrics a smaller backlog is better, so "down" is shown as good.
  const good = delta !== null && delta <= 0;
  const period = days === 7 ? 'from last week' : `vs ${days} days ago`;
  return (
    <Link href={href} className="card kpi">
      <span className="kpi-icon" style={{ background: tint, color }}>
        <Icon size={22} />
      </span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-row">
        <span className="kpi-value">{series ? series.current.toLocaleString() : '—'}</span>
        <span className="kpi-spark">{series && <Sparkline points={series.points} color={color} label={label} />}</span>
      </span>
      <span className="kpi-delta">
        {delta === null ? (
          <span>{series ? `${series.previous.toLocaleString()} at start of period` : ' '}</span>
        ) : (
          <>
            <strong className={good ? 'delta-good' : 'delta-bad'}>
              {delta < 0 ? <ArrowDown size={14} /> : delta > 0 ? <ArrowUp size={14} /> : null}
              {Math.abs(delta) < 10 ? Math.abs(delta).toFixed(1) : Math.round(Math.abs(delta))}%
            </strong>
            {period}
          </>
        )}
      </span>
    </Link>
  );
}

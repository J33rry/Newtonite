'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  ChartCard, Columns, FLOW_SERIES, FlowChart, formatHours, Legend, PRIORITY_LEGEND, TeamPriorityBars, TrendLine,
} from '@/components/charts/Charts';
import { SERIES, shortDate } from '@/components/charts/theme';
import { PageHeader } from '@/components/ui';
import { useInsights, useMe } from '@/lib/queries';

const RANGES = [7, 30, 90] as const;

export default function InsightsPage() {
  const me = useMe();
  const [days, setDays] = useState<number>(30);
  const [team, setTeam] = useState('');
  const { data: d, error, isPlaceholderData } = useInsights(days, team || undefined);

  const created = d?.flow.reduce((s, r) => s + r.created, 0) ?? 0;
  const resolved = d?.flow.reduce((s, r) => s + r.resolved, 0) ?? 0;
  const backlogChange = d ? d.kpis.open.current - d.kpis.open.previous : 0;
  const p1 = d?.resolution.find((r) => r.priority === 1);
  const teamRows = d?.byTeam.slice(0, 8) ?? [];
  // One unit for the whole time-to-resolve axis: days when any median exceeds two days, else hours.
  const maxMedian = Math.max(0, ...(d?.resolution ?? []).map((r) => r.median_hours ?? 0));
  const inDays = maxMedian >= 48;
  const resolutionRows = (d?.resolution ?? []).map((r) => ({
    ...r,
    label: `P${r.priority}`,
    value: r.median_hours === null ? null : inDays ? r.median_hours / 24 : r.median_hours,
  }));

  return (
    <div className={isPlaceholderData ? 'dim' : ''}>
      <PageHeader title="Insights" subtitle="Throughput, backlog health and how quickly work gets resolved">
        {me.data && me.data.teams.length > 1 && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
            <option value="">All my teams</option>
            {me.data.teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        <label className="relative" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <CalendarDays size={16} style={{ position: 'absolute', left: 12, color: 'var(--ink-2)', pointerEvents: 'none' }} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range" style={{ paddingLeft: 36 }}>
            {RANGES.map((r) => (
              <option key={r} value={r}>Last {r} days</option>
            ))}
          </select>
        </label>
      </PageHeader>

      {error && <div className="alert alert-error">Could not load insights: {(error as Error).message}</div>}

      <div className="stat-row">
        <Stat label="Created" value={created.toLocaleString()} sub={`in the last ${days} days`} />
        <Stat label="Resolved" value={resolved.toLocaleString()} sub={created ? `${Math.round((resolved / created) * 100)}% of incoming` : '—'} />
        <Stat
          label="Backlog change"
          value={`${backlogChange > 0 ? '+' : ''}${backlogChange.toLocaleString()}`}
          sub={backlogChange > 0 ? 'growing — more in than out' : backlogChange < 0 ? 'shrinking' : 'flat'}
          tone={backlogChange > 0 ? 'bad' : backlogChange < 0 ? 'good' : undefined}
        />
        <Stat label="P1 median time to resolve" value={formatHours(p1?.median_hours ?? null)} sub={p1?.resolved ? `${p1.resolved} resolved · p90 ${formatHours(p1.p90_hours)}` : 'none resolved in range'} />
      </div>

      <div className="insights-grid">
        <ChartCard
          className="span-2"
          title="Created vs resolved"
          subtitle="Daily flow of work in and out"
          legend={<Legend items={FLOW_SERIES.map((s) => ({ color: s.color, label: s.label }))} />}
          table={{ columns: ['Date', 'Created', 'Resolved'], rows: (d?.flow ?? []).map((r) => [shortDate(r.date), r.created, r.resolved]) }}
          height={280}
        >
          {d ? <FlowChart data={d.flow} /> : <div className="skeleton" style={{ height: '100%' }} />}
        </ChartCard>

        <ChartCard
          title="Open backlog"
          subtitle="Active items at the end of each day"
          table={{ columns: ['Date', 'Open items'], rows: (d?.kpis.open.points ?? []).map((p) => [shortDate(p.date), p.value]) }}
        >
          {d ? <TrendLine points={d.kpis.open.points} label="Open items" /> : <div className="skeleton" style={{ height: '100%' }} />}
        </ChartCard>

        <ChartCard
          title="Active work by team"
          subtitle="Split by priority (darker = more urgent)"
          legend={<Legend items={PRIORITY_LEGEND} />}
          table={{ columns: ['Team', 'P1', 'P2', 'P3', 'P4', 'Total'], rows: (d?.byTeam ?? []).map((t) => [t.team, t.p1, t.p2, t.p3, t.p4, t.total]) }}
          height={Math.max(160, teamRows.length * 44)}
        >
          {d ? <TeamPriorityBars data={teamRows} /> : <div className="skeleton" style={{ height: '100%' }} />}
        </ChartCard>

        <ChartCard
          title="Time to resolve"
          subtitle={`Median by priority, items resolved in the last ${days} days`}
          table={{
            columns: ['Priority', 'Resolved', 'Median', 'p90'],
            rows: (d?.resolution ?? []).map((r) => [`P${r.priority}`, r.resolved, formatHours(r.median_hours), formatHours(r.p90_hours)]),
          }}
        >
          {d ? (
            <Columns
              data={resolutionRows}
              x="label"
              y="value"
              format={(v) => `${inDays ? Number(v.toFixed(1)) : Math.round(v)}${inDays ? 'd' : 'h'}`}
              tooltipRows={(r) => [
                { color: SERIES.blue, label: 'Median', value: formatHours(r.median_hours) },
                { color: 'transparent', label: 'p90', value: formatHours(r.p90_hours) },
                { color: 'transparent', label: 'Resolved', value: r.resolved.toLocaleString() },
              ]}
            />
          ) : (
            <div className="skeleton" style={{ height: '100%' }} />
          )}
        </ChartCard>

        <ChartCard
          title="Age of active work"
          subtitle="How long open items have existed"
          table={{ columns: ['Age', 'Items'], rows: (d?.aging ?? []).map((a) => [a.bucket, a.count]) }}
        >
          {d ? <Columns data={d.aging} x="bucket" y="count" /> : <div className="skeleton" style={{ height: '100%' }} />}
        </ChartCard>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone === 'good' ? 'delta-good' : tone === 'bad' ? 'delta-bad' : ''}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

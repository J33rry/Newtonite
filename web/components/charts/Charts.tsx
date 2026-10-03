'use client';

import { useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, Table2 } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/format';
import { CHROME, compact, formatHours, PRIORITY_RAMP, SERIES, shortDate, STATUS_COLORS, STATUS_ORDER } from './theme';

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

interface TooltipRow {
  color: string;
  label: string;
  value: string;
}

export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="tt-row">
          <span>
            <i className="swatch" style={{ background: r.color }} />
            {r.label}
          </span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <i className="swatch" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A titled chart card with a chart/table toggle. Every chart has an accessible table view with
 * the exact numbers (needed anyway where a series colour is below 3:1 contrast).
 */
export function ChartCard({
  title, subtitle, legend, table, children, className = '', height = 240,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`card card-pad ${className}`}>
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="actions">
          {legend}
          <div className="view-toggle" role="group" aria-label="Chart or table view">
            <button className={mode === 'chart' ? 'on' : ''} onClick={() => setMode('chart')} aria-label="Show chart" title="Chart">
              <BarChart3 size={15} />
            </button>
            <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')} aria-label="Show table" title="Table">
              <Table2 size={15} />
            </button>
          </div>
        </div>
      </header>
      {mode === 'chart' ? (
        <div className="chart-box" style={{ height }}>{children}</div>
      ) : (
        <div style={{ maxHeight: height, overflow: 'auto' }}>
          <table className="chart-table">
            <thead>
              <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === 'number' ? v.toLocaleString() : v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const axisProps = {
  stroke: CHROME.axis,
  tick: { fill: CHROME.axis, fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

// ---------------------------------------------------------------------------------------------
// Sparkline (KPI tiles)
// ---------------------------------------------------------------------------------------------

export function Sparkline({ points, color, label }: { points: { date: string; value: number }[]; color: string; label: string }) {
  const id = `spark-${label.replace(/\W/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox title={shortDate(payload[0].payload.date)} rows={[{ color, label, value: Number(payload[0].value).toLocaleString() }]} />
            ) : null
          }
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false}
          activeDot={{ r: 4, fill: color, stroke: CHROME.surface, strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------------------------
// Created vs resolved (one axis, two series, area wash under each line)
// ---------------------------------------------------------------------------------------------

export const FLOW_SERIES = [
  { key: 'created', label: 'Created', color: SERIES.blue },
  { key: 'resolved', label: 'Resolved', color: SERIES.aqua },
] as const;

/** The last day of a window is today, which is still in progress — label it so a low value is not misread as a drop. */
const todayIso = () => new Date().toLocaleDateString('en-CA');
export const dayLabel = (iso: string) => (iso === todayIso() ? 'Today' : shortDate(iso));
const dayTitle = (iso: string) => (iso === todayIso() ? 'Today (so far)' : shortDate(iso));

export function FlowChart({ data }: { data: { date: string; created: number; resolved: number }[] }) {
  const showDots = data.length <= 14;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          {FLOW_SERIES.map((s) => (
            <linearGradient key={s.key} id={`flow-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={24} dy={6} />
        <YAxis allowDecimals={false} {...axisProps} width={44} tickFormatter={compact} />
        <Tooltip
          cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={dayTitle(String(label))}
                rows={FLOW_SERIES.map((s) => ({ color: s.color, label: s.label, value: Number(payload[0].payload[s.key]).toLocaleString() }))}
              />
            ) : null
          }
        />
        {FLOW_SERIES.map((s) => (
          <Area key={`a-${s.key}`} type="linear" dataKey={s.key} stroke="none" fill={`url(#flow-${s.key})`} isAnimationActive={false} tooltipType="none" />
        ))}
        {FLOW_SERIES.map((s) => (
          <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            dot={showDots ? { r: 4, fill: s.color, stroke: CHROME.surface, strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: s.color, stroke: CHROME.surface, strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------------------------
// Work by status (donut, ≤ 4 segments, fixed order, 2px surface gap)
// ---------------------------------------------------------------------------------------------

export function StatusDonut({ data, total }: { data: { status: string; count: number }[]; total: number }) {
  const ordered = STATUS_ORDER.map((s) => ({ status: s, count: data.find((d) => d.status === s)?.count ?? 0 }));
  return (
    <div className="donut-wrap">
      <div className="donut-box">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={STATUS_LABEL[payload[0].payload.status as keyof typeof STATUS_LABEL]}
                    rows={[{
                      color: STATUS_COLORS[payload[0].payload.status],
                      label: 'Items',
                      value: `${Number(payload[0].value).toLocaleString()} · ${total ? Math.round((Number(payload[0].value) / total) * 100) : 0}%`,
                    }]}
                  />
                ) : null
              }
            />
            <Pie data={ordered} dataKey="count" nameKey="status" innerRadius={56} outerRadius={84} startAngle={90} endAngle={-270}
              stroke={CHROME.surface} strokeWidth={2} isAnimationActive={false}>
              {ordered.map((d) => <Cell key={d.status} fill={STATUS_COLORS[d.status]} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{compact(total)}</strong>
          <span>active</span>
        </div>
      </div>
      <div className="donut-legend">
        {ordered.map((d) => (
          <div key={d.status} style={{ display: 'contents' }}>
            <i className="swatch" style={{ background: STATUS_COLORS[d.status] }} />
            <span>{STATUS_LABEL[d.status as keyof typeof STATUS_LABEL]}</span>
            <span className="num">{d.count.toLocaleString()}</span>
            <span className="pct">{total ? Math.round((d.count / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Active work by team, stacked by priority (horizontal, ordinal one-hue ramp)
// ---------------------------------------------------------------------------------------------

export function TeamPriorityBars({ data }: { data: { team: string; p1: number; p2: number; p3: number; p4: number; total: number }[] }) {
  const keys = ['p1', 'p2', 'p3', 'p4'] as const;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }} barCategoryGap="28%">
        <CartesianGrid horizontal={false} stroke={CHROME.grid} />
        <XAxis type="number" {...axisProps} tickFormatter={compact} allowDecimals={false} />
        <YAxis type="category" dataKey="team" {...axisProps} width={140} tick={{ fill: CHROME.ink, fontSize: 13 }} />
        <Tooltip
          cursor={{ fill: 'rgba(15,27,61,0.04)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                title={`${label} · ${payload[0].payload.total.toLocaleString()} active`}
                rows={keys.map((k, i) => ({ color: PRIORITY_RAMP[i + 1], label: `P${i + 1}`, value: Number(payload[0].payload[k]).toLocaleString() }))}
              />
            ) : null
          }
        />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="p" fill={PRIORITY_RAMP[i + 1]} stroke={CHROME.surface} strokeWidth={2} maxBarSize={24}
            radius={i === 3 ? [0, 4, 4, 0] : 0} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const PRIORITY_LEGEND = [1, 2, 3, 4].map((p) => ({ color: PRIORITY_RAMP[p], label: `P${p}` }));

// ---------------------------------------------------------------------------------------------
// Single-series columns (time to resolve, ageing)
// ---------------------------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export function Columns<T extends Row>({
  data, x, y, color = SERIES.blue, format = (v: number) => v.toLocaleString(), tooltipRows,
}: {
  data: T[];
  x: string;
  y: string;
  color?: string;
  format?: (v: number) => string;
  tooltipRows?: (row: T) => TooltipRow[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data as Row[]} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey={x} {...axisProps} dy={6} interval={0} />
        <YAxis {...axisProps} width={52} tickFormatter={(v) => format(Number(v))} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(15,27,61,0.04)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={String(label)} rows={tooltipRows?.(payload[0].payload as T) ?? [{ color, label: 'Value', value: format(Number(payload[0].value)) }]} />
            ) : null
          }
        />
        <Bar dataKey={y} fill={color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}
          label={{ position: 'top', fill: CHROME.axis, fontSize: 12, formatter: (v: unknown) => (v == null ? '' : format(Number(v))) }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export { formatHours };

// ---------------------------------------------------------------------------------------------
// Single-series trend (open backlog). One series: no legend box, the card title names it.
// ---------------------------------------------------------------------------------------------

export function TrendLine({ points, color = SERIES.blue, label }: { points: { date: string; value: number }[]; color?: string; label: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.1} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={24} dy={6} />
        <YAxis {...axisProps} width={52} tickFormatter={compact} domain={['auto', 'auto']} allowDecimals={false} />
        <Tooltip
          cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
          content={({ active, payload, label: l }) =>
            active && payload?.length ? (
              <TooltipBox title={`End of ${shortDate(String(l))}`} rows={[{ color, label, value: Number(payload[0].value).toLocaleString() }]} />
            ) : null
          }
        />
        <Area type="linear" dataKey="value" stroke={color} strokeWidth={2} fill="url(#trend-fill)" isAnimationActive={false}
          dot={false} activeDot={{ r: 5, fill: color, stroke: CHROME.surface, strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

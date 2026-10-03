/**
 * Chart colours. Every set below was run through the dataviz palette validator
 * (CVD separation, normal-vision floor, lightness band) against the white card surface:
 *   - flow (created/resolved):        blue, aqua                 — pass
 *   - status donut (ring, all pairs): blue, yellow, red, violet  — pass; yellow < 3:1 contrast,
 *     so the donut always ships a labelled legend with counts and a table view (relief rule)
 *   - priority (ordinal ramp, one hue): blue 650 / 500 / 350 / 250 — pass (--ordinal)
 * Text never wears these colours; they are only used for marks and swatches.
 */
export const SERIES = {
  blue: '#2a78d6',
  aqua: '#1baf7a',
  yellow: '#eda100',
  red: '#e34948',
  violet: '#4a3aa7',
} as const;

export const STATUS_COLORS: Record<string, string> = {
  open: SERIES.blue,
  in_progress: SERIES.yellow,
  blocked: SERIES.red,
  pending_approval: SERIES.violet,
};
/** Fixed donut order (validated as a ring): never re-sorted by value. */
export const STATUS_ORDER = ['open', 'in_progress', 'blocked', 'pending_approval'] as const;

export const PRIORITY_RAMP: Record<number, string> = { 1: '#104281', 2: '#256abf', 3: '#5598e7', 4: '#86b6ef' };

export const CHROME = {
  surface: '#ffffff',
  grid: '#edf0f5',
  axis: '#94a3b8',
  ink: '#0f1b3d',
};

export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Axis/label numbers: full digits below 10,000 (so ticks never collide as "4K, 4K"), compact above. */
export const compact = (n: number) =>
  Math.abs(n) < 10_000 ? n.toLocaleString('en-US') : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function formatHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

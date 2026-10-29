'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, LogIn, LogOut, PauseCircle, ShieldCheck, ShieldX, Truck } from 'lucide-react';

/**
 * Dashboard pieces built from /api/dashboard: the 7-day gate trend, the last 24 hours
 * of yard activity, and the progress of open dispatch plans.
 */

export interface TrendDay { day: string; gateIn: number; gateOut: number; mainGateOut: number }

export interface ActivityItem {
  at: string;
  kind: 'GATE_IN' | 'GATE_OUT' | 'VERIFIED' | 'REJECTED' | 'PDI_PASS' | 'PDI_HOLD' | 'MAIN_GATE_OUT';
  serialNumber: string;
  by: string | null;
  detail: string | null;
}

export interface OpenPlan {
  id: string;
  planNo: string;
  soNumber: string | null;
  createdAt: string;
  total: number;
  inYard: number;
  outOfYard: number;
  mainGateOut: number;
  pdiHold: number;
}

// Categorical slots 1-3 of the validated reference palette (light). Aqua is under 3:1
// on white, so the chart always has a legend, a hover tooltip and a table view.
const SERIES = [
  { key: 'gateIn', label: 'FG gate in', color: '#2a78d6' },
  { key: 'gateOut', label: 'FG gate out', color: '#eb6834' },
  { key: 'mainGateOut', label: 'Main gate out', color: '#1baf7a' },
] as const;

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return { short: d.toLocaleDateString('en-IN', { weekday: 'short' }), date: d.getDate(), long: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) };
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Grouped bars per day: FG gate in, FG gate out, main gate out. Hover a day for its numbers. */
export function TrendChart({ days }: { days: TrendDay[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const height = 190;
  const pad = { top: 12, right: 8, bottom: 28, left: 28 };
  const max = Math.max(4, ...days.flatMap((d) => [d.gateIn, d.gateOut, d.mainGateOut]));
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const top = step * Math.ceil(max / step);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const groupW = days.length ? plotW / days.length : 0;
  const barGap = 2;
  const barW = Math.max(4, Math.min(18, (groupW * 0.62 - barGap * 2) / 3));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const totals = SERIES.map((s) => days.reduce((n, d) => n + d[s.key], 0));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600" aria-label="Legend">
          {SERIES.map((s, i) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
              {s.label} <span className="font-semibold tabular-nums text-slate-900">{totals[i]}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {asTable ? (
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="py-1 font-semibold">Day</th>{SERIES.map((s) => <th key={s.key} className="py-1 text-right font-semibold">{s.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {days.map((d) => (
              <tr key={d.day}><td className="py-1 text-slate-700">{dayLabel(d.day).long}</td>{SERIES.map((s) => <td key={s.key} className="py-1 text-right tabular-nums text-slate-900">{d[s.key]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label={`Last 7 days: ${SERIES.map((s, i) => `${s.label} ${totals[i]}`).join(', ')}`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#cbd5e1' : '#eef2f6'} strokeWidth={1} />
                  <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">{t}</text>
                </g>
              ))}
              {days.map((d, gi) => {
                const gx = pad.left + gi * groupW;
                const startX = gx + (groupW - (barW * 3 + barGap * 2)) / 2;
                const label = dayLabel(d.day);
                const isToday = gi === days.length - 1;
                return (
                  <g key={d.day}>
                    {hover === gi && <rect x={gx + 2} y={pad.top} width={groupW - 4} height={plotH} rx={6} fill="#f1f5f9" />}
                    {SERIES.map((s, si) => {
                      const v = d[s.key];
                      if (v === 0) return null;
                      const x = startX + si * (barW + barGap);
                      const h = Math.max(2, y(0) - y(v));
                      const r = Math.min(4, barW / 2, h);
                      // Rounded top only; the end at the baseline stays square.
                      return <path key={s.key} fill={s.color} d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`} />;
                    })}
                    <text x={gx + groupW / 2} y={height - 14} textAnchor="middle" className={`text-[10px] ${isToday ? 'fill-slate-900 font-semibold' : 'fill-slate-500'}`}>{isToday ? 'Today' : label.short}</text>
                    <text x={gx + groupW / 2} y={height - 2} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">{label.date}</text>
                    {/* Hit target: the whole day column, larger than its bars. */}
                    <rect x={gx} y={pad.top} width={groupW} height={plotH + 24} fill="transparent" onMouseEnter={() => setHover(gi)} onClick={() => setHover(gi)} />
                  </g>
                );
              })}
            </svg>
          )}
          {hover !== null && days[hover] && (
            <div
              className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: Math.min(Math.max(0, pad.left + hover * groupW + groupW / 2 - 75), Math.max(0, width - 160)), top: 0 }}
            >
              <p className="mb-1 font-semibold text-slate-900">{dayLabel(days[hover].day).long}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3 text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{days[hover][s.key]}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const KIND: Record<ActivityItem['kind'], { label: string; icon: React.ReactNode; tone: string }> = {
  GATE_IN: { label: 'Gate in', icon: <LogIn className="h-3.5 w-3.5" />, tone: 'bg-blue-100 text-blue-700' },
  GATE_OUT: { label: 'Gate out', icon: <LogOut className="h-3.5 w-3.5" />, tone: 'bg-orange-100 text-orange-700' },
  VERIFIED: { label: 'Parking verified', icon: <ShieldCheck className="h-3.5 w-3.5" />, tone: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: 'Parking rejected', icon: <ShieldX className="h-3.5 w-3.5" />, tone: 'bg-red-100 text-red-700' },
  PDI_PASS: { label: 'PDI passed', icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: 'bg-emerald-100 text-emerald-700' },
  PDI_HOLD: { label: 'PDI hold', icon: <PauseCircle className="h-3.5 w-3.5" />, tone: 'bg-amber-100 text-amber-800' },
  MAIN_GATE_OUT: { label: 'Main gate out', icon: <Truck className="h-3.5 w-3.5" />, tone: 'bg-teal-100 text-teal-700' },
};

function ago(iso: string) {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60 ? `${mins % 60} min ` : ''}ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** The latest yard events of the last 7 days, newest first. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">No yard activity in the last 7 days</p>;
  }
  return (
    <ol className="relative space-y-0.5">
      {items.map((a, i) => {
        const k = KIND[a.kind];
        return (
          <li key={`${a.at}-${a.serialNumber}-${i}`} className="flex gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-slate-50">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${k.tone}`} aria-hidden="true">{k.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate"><span className="font-semibold text-slate-900">{a.serialNumber}</span> <span className="text-slate-600">{k.label}</span></span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400" title={new Date(a.at).toLocaleString('en-IN')}>{ago(a.at)}</span>
              </p>
              {(a.by || a.detail) && (
                <p className="truncate text-[11px] text-slate-500">{[a.by, a.detail].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One row per open plan: how many machines are out of the plant, out of the FG yard, still in the yard. */
export function PlanProgress({ plans, total, now, onOpen }: { plans: OpenPlan[]; total: number; now: number; onOpen?: () => void }) {
  if (plans.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center">
        <ClipboardList className="h-6 w-6 text-slate-300" />
        <p className="text-sm text-slate-500">No open dispatch plans</p>
      </div>
    );
  }
  const parts = [
    { key: 'mainGateOut', label: 'Out of plant', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    { key: 'outOfYard', label: 'Out of FG yard', bar: 'bg-sky-400', dot: 'bg-sky-400' },
    { key: 'inYard', label: 'In FG yard', bar: 'bg-slate-300', dot: 'bg-slate-300' },
  ] as const;
  return (
    <div className="space-y-2.5">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {parts.map((p) => <li key={p.key} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${p.dot}`} />{p.label}</li>)}
      </ul>
      <ul className="space-y-2">
        {plans.map((p) => {
          const days = Math.floor((now - Date.parse(p.createdAt)) / 86_400_000);
          return (
            <li key={p.id}>
              <button type="button" onClick={onOpen} disabled={!onOpen} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors enabled:hover:border-blue-200 enabled:hover:bg-blue-50/30">
                <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
                  <span className="font-semibold text-slate-900">{p.planNo}{p.soNumber && <span className="ml-1.5 font-normal text-slate-500">SO {p.soNumber}</span>}</span>
                  <span className="flex items-center gap-2 tabular-nums text-slate-500">
                    {p.pdiHold > 0 && <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">PDI hold {p.pdiHold}</span>}
                    <span><span className="font-semibold text-slate-900">{p.mainGateOut}</span>/{p.total} out of plant</span>
                    <span>· {days === 0 ? 'today' : `${days} d old`}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full" role="img"
                  aria-label={`${p.mainGateOut} out of plant, ${p.outOfYard} out of FG yard, ${p.inYard} in FG yard`}>
                  {parts.map((part) => p[part.key] > 0 && (
                    <span key={part.key} className={part.bar} style={{ width: `${(p[part.key] / Math.max(1, p.total)) * 100}%` }} />
                  ))}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {total > plans.length && <p className="text-[11px] font-medium text-slate-500">+{total - plans.length} more open plans in Dispatch Planning</p>}
    </div>
  );
}

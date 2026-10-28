'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { StatCard, SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { slotLabel, formatDateShort, formatDateTime } from '@/lib/format';
import { AlertTriangle, Boxes, Check, ClipboardCheck, DoorOpen, MapPin, Minus, PackageCheck, Phone, Printer, RefreshCw, Search, Truck, Undo2 } from 'lucide-react';

export type DispatchStatus = 'PLANNED' | 'DRIVER_ASSIGNED' | 'OUT_OF_YARD' | 'MAIN_GATE_OUT' | 'CANCELLED';

export interface DispatchItem {
  id: string;
  status: DispatchStatus;
  planId: string;
  planNo: string;
  soNumber: string | null;
  plannedAt: string;
  plannedBy: { id: string; name: string };
  modelType: string;
  inwardAt: string | null;
  driver: { id: string; name: string; employeeCode: string | null; phone: string | null } | null;
  driverAssignedAt: string | null;
  gateOutAt: string | null;
  mainGateOutAt: string | null;
  mainGateOutBy: { id: string; name: string } | null;
  mainGateSource: 'MANUAL' | 'API' | null;
  mainGateRef: string | null;
  pdiStatus: 'PASSED' | 'HOLD' | null;
  pdiAt: string | null;
  pdiBy: { id: string; name: string } | null;
  pdiRemark: string | null;
  cancelledAt: string | null;
  returnedAt: string | null;
  machine: {
    id: string;
    serialNumber: string;
    barcode: string | null;
    model: string;
    parkStatus: string;
    yard: { id: string; name: string } | null;
    row: number | null;
    col: number | null;
  };
}

export const DISPATCH_STATUS: Record<DispatchStatus, { label: string; variant: 'purple' | 'blue' | 'amber' | 'green' | 'gray' }> = {
  PLANNED: { label: 'Planned', variant: 'purple' },
  DRIVER_ASSIGNED: { label: 'Driver assigned', variant: 'blue' },
  OUT_OF_YARD: { label: 'Out of FG yard', variant: 'amber' },
  MAIN_GATE_OUT: { label: 'Main gate out', variant: 'green' },
  CANCELLED: { label: 'Cancelled', variant: 'gray' },
};

/** Status label of a dispatch machine; a returned machine is told apart from a planner's cancel. */
export function dispatchStatusMeta(i: DispatchItem) {
  if (i.status === 'CANCELLED' && i.returnedAt) return { label: 'Returned to FG yard', variant: 'amber' as const };
  return DISPATCH_STATUS[i.status];
}

export function dispatchLocation(m: { yard: { name: string } | null; row: number | null; col: number | null }) {
  if (!m.yard) return '—';
  return m.row !== null && m.col !== null ? `${m.yard.name} · ${slotLabel(m.row, m.col)}` : m.yard.name;
}

type StepState = 'done' | 'current' | 'todo' | 'skipped';

/**
 * The five steps of a dispatch: planned, driver (optional), FG gate-out, PDI final check,
 * main gate-out. A driver step left empty once the machine is out counts as skipped, not
 * missing.
 */
export function dispatchSteps(i: DispatchItem): { label: string; at: string | null; state: StepState; note?: string }[] {
  const out = !!i.gateOutAt;
  const steps: { label: string; at: string | null; state: StepState; note?: string }[] = [
    { label: 'Planned', at: i.plannedAt, state: 'done', note: `${i.planNo} by ${i.plannedBy.name}` },
    {
      label: 'Driver',
      at: i.driverAssignedAt,
      state: i.driver ? 'done' : out ? 'skipped' : 'current',
      note: i.driver ? i.driver.name : out ? 'Not assigned' : 'Optional',
    },
    { label: 'FG gate-out', at: i.gateOutAt, state: out ? 'done' : i.driver ? 'current' : 'todo' },
    {
      label: 'PDI check',
      at: i.pdiAt,
      state: i.pdiStatus === 'PASSED' ? 'done' : out ? 'current' : 'todo',
      note: i.pdiStatus === 'PASSED'
        ? `Passed by ${i.pdiBy?.name ?? ''}${i.pdiRemark ? ` · ${i.pdiRemark}` : ''}`
        : i.pdiStatus === 'HOLD' ? `On hold by ${i.pdiBy?.name ?? ''}: ${i.pdiRemark ?? ''}` : undefined,
    },
    {
      label: 'Main gate',
      at: i.mainGateOutAt,
      state: i.mainGateOutAt ? 'done' : i.pdiStatus === 'PASSED' ? 'current' : 'todo',
      note: i.mainGateOutAt
        ? `${i.mainGateSource === 'API' ? 'Main gate system' : i.mainGateOutBy?.name ?? ''}${i.mainGateRef ? ` · Ref ${i.mainGateRef}` : ''}`
        : undefined,
    },
  ];
  if (i.status === 'CANCELLED') steps.forEach((s, n) => { if (n > 0 && s.state !== 'done') s.state = 'todo'; });
  return steps;
}

const STEP_DOT: Record<StepState, string> = {
  done: 'bg-emerald-500 border-emerald-500 text-white',
  current: 'bg-white border-blue-500 text-blue-600 ring-2 ring-blue-100',
  todo: 'bg-white border-slate-300 text-slate-300',
  skipped: 'bg-slate-100 border-slate-300 text-slate-400',
};

/** PDI result of a machine that is out of the FG yard. */
export const PDI_STATUS = {
  PENDING: { label: 'PDI pending', variant: 'gray' as const },
  PASSED: { label: 'PDI passed', variant: 'green' as const },
  HOLD: { label: 'PDI hold', variant: 'red' as const },
};

export function pdiMeta(i: DispatchItem) {
  return PDI_STATUS[i.pdiStatus ?? 'PENDING'];
}

/** Compact five-dot progress line for a table row. */
export function DispatchProgress({ item }: { item: DispatchItem }) {
  const steps = dispatchSteps(item);
  return (
    <div className="flex items-center" aria-label={steps.map((s) => `${s.label}: ${s.state}`).join(', ')}>
      {steps.map((s, n) => (
        <div key={s.label} className="flex items-center">
          {n > 0 && <span className={`h-0.5 w-3 ${s.state === 'done' ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
          <span title={`${s.label}${s.at ? ` · ${formatDateTime(s.at)}` : ''}`} className={`flex h-4 w-4 items-center justify-center rounded-full border ${STEP_DOT[s.state]}`}>
            {s.state === 'done' ? <Check className="h-2.5 w-2.5" /> : s.state === 'skipped' ? <Minus className="h-2.5 w-2.5" /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What has to happen next, in plain words. */
function nextStep(i: DispatchItem, isMainGate: boolean): string {
  switch (i.status) {
    case 'PLANNED': return 'Assign a driver (optional) and print the slip';
    case 'DRIVER_ASSIGNED': return 'Driver to collect it and go out through the FG gate';
    case 'OUT_OF_YARD':
      if (i.pdiStatus === 'HOLD') return `PDI hold: ${i.pdiRemark ?? ''} - re-check after rectification`;
      if (i.pdiStatus !== 'PASSED') return isMainGate ? 'Waiting for the PDI final check' : 'Do the PDI final check';
      return isMainGate ? 'PDI passed - click Main Gate Out when it leaves' : 'PDI passed - waiting for main gate-out';
    case 'MAIN_GATE_OUT': return 'Completed';
    default: return i.returnedAt ? 'Came back into the FG yard before main gate-out; on return hold in Yard Stock' : 'Cancelled by the planner';
  }
}

function sinceLabel(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms > 0 ? `+${formatWait(ms)}` : null;
}

type Filter = 'IN_YARD' | 'AT_PDI' | 'READY_GATE' | 'MAIN_GATE_OUT' | 'ALL';

// Out of the FG yard splits on the PDI result: not passed yet (pending or hold) or ready to leave.
const FILTERS: { value: Filter; label: string; match: (i: DispatchItem) => boolean; tone: string }[] = [
  { value: 'IN_YARD', label: 'In FG yard', match: (i) => i.status === 'PLANNED' || i.status === 'DRIVER_ASSIGNED', tone: 'bg-violet-50 text-violet-700' },
  { value: 'AT_PDI', label: 'At PDI', match: (i) => i.status === 'OUT_OF_YARD' && i.pdiStatus !== 'PASSED', tone: 'bg-amber-50 text-amber-700' },
  { value: 'READY_GATE', label: 'Ready for main gate', match: (i) => i.status === 'OUT_OF_YARD' && i.pdiStatus === 'PASSED', tone: 'bg-blue-50 text-blue-700' },
  { value: 'MAIN_GATE_OUT', label: 'Main gate out', match: (i) => i.status === 'MAIN_GATE_OUT', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'ALL', label: 'All', match: () => true, tone: 'bg-slate-100 text-slate-700' },
];

const HOUR_MS = 3_600_000;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Time from FG gate-out to main gate-out, or to now while the machine is still waiting. */
function waitMs(i: DispatchItem, now: number): number | null {
  if (!i.gateOutAt) return null;
  const end = i.mainGateOutAt ? new Date(i.mainGateOutAt).getTime() : now;
  return Math.max(0, end - new Date(i.gateOutAt).getTime());
}

function formatWait(ms: number) {
  const h = Math.floor(ms / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / 60_000);
  return `${h} h ${String(m).padStart(2, '0')} m`;
}

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Pick slip for the driver: which machine to take from which slot. One section per
 * driver, so a slip can be cut and handed over.
 */
function printSlip(items: DispatchItem[], printedBy: string) {
  const groups = new Map<string, DispatchItem[]>();
  for (const i of items) {
    const key = i.driver ? `${i.driver.name}${i.driver.employeeCode ? ` (${i.driver.employeeCode})` : ''}` : 'Driver not assigned';
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const sections = [...groups].map(([driver, list]) => `
    <section>
      <h2>Driver: ${esc(driver)}</h2>
      <table>
        <thead><tr><th>#</th><th>Yard</th><th>Slot</th><th>Serial Number</th><th>Barcode</th><th>Model-type</th><th>Plan</th></tr></thead>
        <tbody>
          ${list.map((i, n) => `<tr>
            <td>${n + 1}</td>
            <td>${esc(i.machine.yard?.name ?? '-')}</td>
            <td class="slot">${i.machine.row !== null && i.machine.col !== null ? esc(slotLabel(i.machine.row, i.machine.col)) : '-'}</td>
            <td class="serial">${esc(i.machine.serialNumber)}</td>
            <td>${esc(i.machine.barcode ?? '-')}</td>
            <td>${esc(i.modelType)}</td>
            <td>${esc(i.planNo)}${i.soNumber ? `<br>SO ${esc(i.soNumber)}` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="sign"><span>Driver signature</span><span>PDI signature</span></div>
    </section>`).join('');

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { window.alert('Allow pop-ups for this site to print the slip.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Dispatch Pick Slip</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
      h1 { font-size: 18px; margin: 0; }
      .meta { font-size: 12px; color: #444; margin: 4px 0 16px; }
      section { border: 1px solid #999; border-radius: 6px; padding: 12px; margin-bottom: 16px; page-break-inside: avoid; }
      h2 { font-size: 14px; margin: 0 0 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #bbb; padding: 6px; text-align: left; }
      th { background: #f0f0f0; }
      td.slot { font-size: 16px; font-weight: bold; }
      td.serial { font-weight: bold; }
      .sign { display: flex; justify-content: space-between; margin-top: 28px; font-size: 12px; }
      .sign span { border-top: 1px solid #333; padding-top: 4px; width: 40%; text-align: center; }
    </style></head><body>
    <h1>FG Yard - Dispatch Pick Slip</h1>
    <div class="meta">Printed ${esc(formatDateTime(new Date().toISOString()))} by ${esc(printedBy)} · ${items.length} machine${items.length === 1 ? '' : 's'}</div>
    ${sections}
    <script>window.onload = function () { window.print(); };</script>
    </body></html>`);
  w.document.close();
}

export default function DispatchList() {
  const { user, can } = useAuth();
  const role = user?.role || '';
  const isMainGate = role === 'MAIN_GATE';
  const canAssign = can('pdi.assign');
  const canPdi = can('pdi.check');
  const canGateOut = can('pdi.mainGate');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // The main gate user only sees machines that have left the FG yard.
  const filters = isMainGate ? FILTERS.filter((f) => f.value === 'AT_PDI' || f.value === 'READY_GATE' || f.value === 'MAIN_GATE_OUT') : FILTERS;

  const [items, setItems] = useState<DispatchItem[]>([]);
  const [alertHours, setAlertHours] = useState(8);
  const [drivers, setDrivers] = useState<{ id: string; name: string; employeeCode: string | null }[]>([]);
  const [filterChoice, setFilter] = useState<Filter>(isMainGate ? 'READY_GATE' : 'IN_YARD');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pdiItem, setPdiItem] = useState<DispatchItem | null>(null);
  const [pdiRemark, setPdiRemark] = useState('');
  const [pdiError, setPdiError] = useState<string | null>(null);
  const [pdiSaving, setPdiSaving] = useState(false);

  const fetchItems = useCallback(async (): Promise<{ alertHours: number; items: DispatchItem[] }> => {
    const res = await fetch(`${API_URL}/api/dispatch-plans/items`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`GET /api/dispatch-plans/items -> ${res.status}`);
    return res.json();
  }, [API_URL]);

  // State is only set from the promise callbacks, and a late response after the page
  // has closed is dropped.
  const load = useCallback((isCurrent: () => boolean = () => true) =>
    fetchItems()
      .then((d) => { if (isCurrent()) { setItems(d.items); setAlertHours(d.alertHours); setNow(Date.now()); setError(null); } })
      .catch((err) => {
        console.error('Failed to load dispatch list:', err);
        if (isCurrent()) setError('Could not load the dispatch list. Check that the backend is running, then refresh.');
      })
      .finally(() => { if (isCurrent()) { setLoading(false); setRefreshing(false); } }),
  [fetchItems]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  // The waiting time counts up live; the list itself reloads every 5 minutes.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const reload = setInterval(() => { load(); }, 5 * 60_000);
    return () => { clearInterval(tick); clearInterval(reload); };
  }, [load]);

  useEffect(() => {
    if (!canAssign) return;
    fetch(`${API_URL}/api/drivers`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setDrivers(Array.isArray(list) ? list.map((d: { id: string; name: string; employeeCode: string | null }) => ({ id: d.id, name: d.name, employeeCode: d.employeeCode })) : []))
      .catch(() => setDrivers([]));
  }, [API_URL, canAssign]);

  const refresh = () => { setRefreshing(true); load(); };

  // The signed-in user can arrive after the first render, so fall back to a tab this
  // role actually has.
  const filter: Filter = filters.some((f) => f.value === filterChoice) ? filterChoice : filters[0].value;

  const term = search.trim().toLowerCase();
  const filterMatch = FILTERS.find((f) => f.value === filter)!.match;
  const visible = items.filter((i) => filterMatch(i) && (!term ||
    i.machine.serialNumber.toLowerCase().includes(term) ||
    i.planNo.toLowerCase().includes(term) ||
    (i.soNumber?.toLowerCase().includes(term) ?? false) ||
    i.modelType.toLowerCase().includes(term) ||
    (i.driver?.name.toLowerCase().includes(term) ?? false)));
  // In the FG yard, list by yard and slot so the driver's round is easy to follow.
  if (filter === 'IN_YARD') {
    visible.sort((a, b) =>
      (a.machine.yard?.name ?? '').localeCompare(b.machine.yard?.name ?? '') ||
      (a.machine.row ?? 0) - (b.machine.row ?? 0) ||
      (a.machine.col ?? 0) - (b.machine.col ?? 0));
  }
  const detail = items.find((i) => i.id === detailId) ?? null;

  const inYard = (i: DispatchItem) => i.status === 'PLANNED' || i.status === 'DRIVER_ASSIGNED';
  const overdue = (i: DispatchItem) => i.status === 'OUT_OF_YARD' && (waitMs(i, now) ?? 0) > alertHours * HOUR_MS;
  const printable = visible.filter(inYard);
  const pickedItems = printable.filter((i) => picked.has(i.id));
  const allPicked = printable.length > 0 && pickedItems.length === printable.length;
  const showWait = filter !== 'IN_YARD';

  const send = async (item: DispatchItem, method: 'PUT' | 'POST', path: string, body: unknown) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/dispatch-plans/items/${item.id}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setActionError(`${item.machine.serialNumber}: ${data?.error || `request failed (${res.status})`}`); return; }
      setItems((prev) => prev.map((i) => (i.id === item.id ? (data as DispatchItem) : i)));
    } catch {
      setActionError('Connection error - try again');
    } finally {
      setBusyId(null);
    }
  };

  const togglePick = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openPdi = (i: DispatchItem) => {
    setPdiItem(i);
    setPdiRemark(i.pdiStatus === 'HOLD' ? '' : i.pdiRemark ?? '');
    setPdiError(null);
  };

  const savePdi = async (result: 'PASS' | 'HOLD') => {
    if (!pdiItem) return;
    setPdiSaving(true);
    setPdiError(null);
    try {
      const res = await fetch(`${API_URL}/api/dispatch-plans/items/${pdiItem.id}/pdi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ result, remark: pdiRemark }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setPdiError(data?.error || `Save failed (${res.status})`); return; }
      setItems((prev) => prev.map((i) => (i.id === pdiItem.id ? (data as DispatchItem) : i)));
      setPdiItem(null);
    } catch {
      setPdiError('Connection error - try again');
    } finally {
      setPdiSaving(false);
    }
  };

  const markMainGateOut = (i: DispatchItem) => {
    if (window.confirm(`Mark ${i.machine.serialNumber} as gone out of the main gate?`)) send(i, 'POST', 'main-gate-out', {});
  };

  if (loading) return <PageSpinner />;

  const count = (f: Filter) => items.filter((i) => FILTERS.find((x) => x.value === f)!.match(i)).length;
  const overdueCount = items.filter(overdue).length;
  // Overdue machines can be waiting for PDI or for the main gate; open the tab that has them.
  const overdueTab: Filter = items.some((i) => overdue(i) && i.pdiStatus !== 'PASSED') ? 'AT_PDI' : 'READY_GATE';

  return (
    <div className="space-y-3">
      <PageHeader
        title="Dispatch Machine List"
        description={isMainGate
          ? 'Machines that have left the FG yard: mark them out when they pass the main gate'
          : 'Machines planned for dispatch: assign a driver, print the pick slip, do the PDI final check, and follow them to the main gate'}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh} icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}>Refresh</Button>
            {!isMainGate && (
              <Button
                variant="secondary"
                onClick={() => printSlip(pickedItems, user?.name || '')}
                disabled={pickedItems.length === 0}
                icon={<Printer className="w-4 h-4" />}
              >
                Print Slip{pickedItems.length ? ` (${pickedItems.length})` : ''}
              </Button>
            )}
          </div>
        }
      />

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
      {overdueCount > 0 && (
        <button
          type="button"
          onClick={() => setFilter(overdueTab)}
          className="flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-800"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {overdueCount} machine{overdueCount === 1 ? ' has' : 's have'} been out of the FG yard more than {alertHours} hours without main gate-out.
        </button>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {!isMainGate && (
          <StatCard label="In FG yard" value={count('IN_YARD')} icon={<Boxes className="w-4 h-4" />} color="purple" hint="To be taken out" onClick={() => setFilter('IN_YARD')} />
        )}
        <StatCard label="At PDI" value={count('AT_PDI')} icon={<ClipboardCheck className="w-4 h-4" />} color="amber" hint="Check pending or on hold" onClick={() => setFilter('AT_PDI')} />
        <StatCard label="Ready for main gate" value={count('READY_GATE')} icon={<PackageCheck className="w-4 h-4" />} color="blue" hint="PDI passed" onClick={() => setFilter('READY_GATE')} />
        <StatCard label={`Over ${alertHours} h`} value={overdueCount} icon={<AlertTriangle className="w-4 h-4" />} color={overdueCount ? 'red' : 'slate'} hint="Not yet out of main gate" onClick={() => setFilter(overdueTab)} />
        <StatCard label="Main gate out" value={count('MAIN_GATE_OUT')} icon={<Truck className="w-4 h-4" />} color="green" onClick={() => setFilter('MAIN_GATE_OUT')} />
      </div>

      <SectionCard
        title={`Machines (${visible.length})`}
        description={filter === 'IN_YARD' ? 'Tick machines and click Print Slip to give the driver the slot list' : undefined}
        noPadding
        action={
          <div className="w-full sm:w-64">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Serial, plan, SO, model-type, driver…" icon={<Search className="w-3.5 h-3.5" />} aria-label="Search dispatch list" />
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-3">
          {filters.map((f) => {
            const n = count(f.value);
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : `${f.tone} hover:opacity-80`} ${n === 0 && !active ? 'opacity-50' : ''}`}
              >
                {f.label}
                <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {actionError && <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-red-700">{actionError}</p>}

        {visible.length === 0 ? (
          <EmptyState
            icon={<Truck className="w-6 h-6 text-slate-400" />}
            title={term ? 'Nothing matches your search' : 'No machines here'}
            description={isMainGate ? 'Machines appear here when they go out of the FG gate' : 'Machines appear here when the planning team plans them for dispatch'}
          />
        ) : (
          <Table>
            <TableHeader>
              {!isMainGate && (
                <TableHeaderCell align="center">
                  {printable.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(printable.map((i) => i.id)))}
                      aria-label="Select all machines in the FG yard for printing"
                    />
                  )}
                </TableHeaderCell>
              )}
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Model-type</TableHeaderCell>
              <TableHeaderCell>{showWait ? 'FG Gate-out' : 'Location'}</TableHeaderCell>
              {showWait && <TableHeaderCell align="right">Since FG Gate-out</TableHeaderCell>}
              <TableHeaderCell>Driver</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right"> </TableHeaderCell>
            </TableHeader>
            <TableBody>
              {visible.map((i) => {
                const meta = dispatchStatusMeta(i);
                const busy = busyId === i.id;
                const wait = waitMs(i, now);
                const late = overdue(i);
                const amber = !late && i.status === 'OUT_OF_YARD' && (wait ?? 0) > (alertHours / 2) * HOUR_MS;
                return (
                  <TableRow key={i.id} className={late ? 'bg-red-50/60' : ''}>
                    {!isMainGate && (
                      <TableCell align="center">
                        {inYard(i) && (
                          <input type="checkbox" checked={picked.has(i.id)} onChange={() => togglePick(i.id)} aria-label={`Select ${i.machine.serialNumber} for printing`} />
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailId(i.id)}
                        className="text-left font-semibold text-blue-700 hover:underline"
                        title="View machine details"
                      >
                        {i.machine.serialNumber}
                      </button>
                      <span className="block text-[11px] text-slate-500">{i.planNo}{i.soNumber ? ` · SO ${i.soNumber}` : ''} · {formatDateShort(i.plannedAt)}</span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      <span className="font-medium">{i.modelType}</span>
                      <span className="block text-[11px] text-slate-400">{i.machine.model}</span>
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {inYard(i) ? (
                        i.machine.yard ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1">
                            <MapPin className="w-3.5 h-3.5 text-violet-600" />
                            <span className="text-xs text-violet-800">{i.machine.yard.name}</span>
                            {i.machine.row !== null && i.machine.col !== null && (
                              <span className="text-sm font-bold text-violet-900">{slotLabel(i.machine.row, i.machine.col)}</span>
                            )}
                          </span>
                        ) : '—'
                      ) : i.gateOutAt ? formatDateTime(i.gateOutAt) : '—'}
                    </TableCell>
                    {showWait && (
                      <TableCell align="right" className="tabular-nums">
                        {wait === null ? '—' : (
                          <span className={`font-semibold ${late ? 'text-red-700' : amber ? 'text-amber-700' : i.status === 'MAIN_GATE_OUT' ? 'text-slate-600' : 'text-emerald-700'}`}>
                            {formatWait(wait)}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {canAssign && inYard(i) ? (
                        <Select
                          value={i.driver?.id ?? ''}
                          onChange={(e) => send(i, 'PUT', 'driver', { driverId: e.target.value || null })}
                          disabled={busy}
                          options={[{ value: '', label: 'Not assigned' }, ...drivers.map((d) => ({ value: d.id, label: d.employeeCode ? `${d.name} (${d.employeeCode})` : d.name }))]}
                          className="min-w-40"
                          aria-label={`Driver for ${i.machine.serialNumber}`}
                        />
                      ) : (
                        <span className="text-[13px]">{i.driver?.name ?? '—'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {i.status === 'OUT_OF_YARD' && <Badge variant={pdiMeta(i).variant}>{pdiMeta(i).label}</Badge>}
                        <DispatchProgress item={i} />
                      </div>
                      <span className={`mt-0.5 block text-[11px] ${late || (i.status === 'OUT_OF_YARD' && i.pdiStatus === 'HOLD') ? 'font-medium text-red-700' : 'text-slate-500'}`}>
                        {late ? `Overdue - over ${alertHours} h since FG gate-out` : nextStep(i, isMainGate)}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-1">
                        {!isMainGate && inYard(i) && (
                          <Button size="sm" variant="ghost" onClick={() => printSlip([i], user?.name || '')} icon={<Printer className="w-3.5 h-3.5" />} aria-label={`Print slip for ${i.machine.serialNumber}`} />
                        )}
                        {canPdi && i.status === 'OUT_OF_YARD' && i.pdiStatus !== 'PASSED' && (
                          <Button size="sm" variant="secondary" onClick={() => openPdi(i)} icon={<ClipboardCheck className="w-3.5 h-3.5" />}>PDI Check</Button>
                        )}
                        {canGateOut && i.status === 'OUT_OF_YARD' && i.pdiStatus === 'PASSED' && (
                          <Button size="sm" variant="success" onClick={() => markMainGateOut(i)} loading={busy} icon={<DoorOpen className="w-3.5 h-3.5" />}>Main Gate Out</Button>
                        )}
                        {canGateOut && i.status === 'MAIN_GATE_OUT' && (
                          <Button size="sm" variant="ghost" onClick={() => send(i, 'POST', 'main-gate-out', { undo: true })} loading={busy} icon={<Undo2 className="w-3.5 h-3.5" />}>Undo</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detail ? detail.machine.serialNumber : undefined}
        subtitle={detail ? `${detail.modelType} · ${detail.machine.model}` : undefined}
        size="lg"
        footer={detail && (
          <>
            {!isMainGate && inYard(detail) && (
              <Button variant="secondary" onClick={() => printSlip([detail], user?.name || '')} icon={<Printer className="w-4 h-4" />}>Print Slip</Button>
            )}
            {canPdi && detail.status === 'OUT_OF_YARD' && (
              <Button variant="secondary" onClick={() => openPdi(detail)} icon={<ClipboardCheck className="w-4 h-4" />}>
                {detail.pdiStatus === 'PASSED' ? 'Change PDI Result' : 'PDI Check'}
              </Button>
            )}
            {canGateOut && detail.status === 'OUT_OF_YARD' && detail.pdiStatus === 'PASSED' && (
              <Button variant="success" onClick={() => markMainGateOut(detail)} loading={busyId === detail.id} icon={<DoorOpen className="w-4 h-4" />}>Main Gate Out</Button>
            )}
            <Button variant="secondary" onClick={() => setDetailId(null)}>Close</Button>
          </>
        )}
      >
        {detail && (() => {
          const wait = waitMs(detail, now);
          const late = overdue(detail);
          const steps = dispatchSteps(detail);
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={dispatchStatusMeta(detail).variant}>{dispatchStatusMeta(detail).label}</Badge>
                {detail.status === 'OUT_OF_YARD' && <Badge variant={pdiMeta(detail).variant}>{pdiMeta(detail).label}</Badge>}
                <span className={`text-xs ${late ? 'font-medium text-red-700' : 'text-slate-600'}`}>
                  {late ? `Overdue - over ${alertHours} h since FG gate-out` : nextStep(detail, isMainGate)}
                </span>
              </div>

              {inYard(detail) ? (
                <div className="flex items-center gap-4 rounded-lg border-2 border-violet-200 bg-violet-50 px-4 py-3">
                  <MapPin className="w-6 h-6 shrink-0 text-violet-600" />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Collect from</p>
                    <p className="text-sm text-violet-900">
                      {detail.machine.yard?.name ?? 'Yard not known'}
                      {detail.machine.row !== null && detail.machine.col !== null && (
                        <span className="ml-2 text-2xl font-bold">{slotLabel(detail.machine.row, detail.machine.col)}</span>
                      )}
                    </p>
                  </div>
                </div>
              ) : wait !== null && (
                <div className={`rounded-lg border-2 px-4 py-3 ${late ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'} ${detail.status === 'MAIN_GATE_OUT' ? 'border-emerald-200 bg-emerald-50' : ''}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {detail.status === 'MAIN_GATE_OUT' ? 'FG gate-out to main gate-out' : 'Since FG gate-out'}
                  </p>
                  <p className={`text-2xl font-bold tabular-nums ${late ? 'text-red-700' : detail.status === 'MAIN_GATE_OUT' ? 'text-emerald-700' : 'text-amber-700'}`}>{formatWait(wait)}</p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                {[
                  ['Serial number', detail.machine.serialNumber],
                  ['Barcode', detail.machine.barcode ?? '—'],
                  ['Model-type', detail.modelType],
                  ['Model', detail.machine.model],
                  ['Plan', detail.planNo],
                  ['SO number', detail.soNumber ?? '—'],
                  ['Planned by', `${detail.plannedBy.name}, ${formatDateShort(detail.plannedAt)}`],
                  ['Yard inward date', detail.inwardAt ? formatDateShort(detail.inwardAt) : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-900 break-words">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[11px] text-slate-500">Driver</dt>
                  <dd className="font-medium text-slate-900">
                    {detail.driver ? (
                      <>
                        {detail.driver.name}{detail.driver.employeeCode ? ` (${detail.driver.employeeCode})` : ''}
                        {detail.driver.phone && (
                          <a href={`tel:${detail.driver.phone}`} className="mt-0.5 flex items-center gap-1 text-xs font-normal text-blue-700 hover:underline">
                            <Phone className="w-3 h-3" />{detail.driver.phone}
                          </a>
                        )}
                      </>
                    ) : 'Not assigned'}
                  </dd>
                </div>
              </dl>

              {canAssign && inYard(detail) && (
                <Select
                  label="Assign driver (optional)"
                  value={detail.driver?.id ?? ''}
                  onChange={(e) => send(detail, 'PUT', 'driver', { driverId: e.target.value || null })}
                  disabled={busyId === detail.id}
                  options={[{ value: '', label: 'Not assigned' }, ...drivers.map((d) => ({ value: d.id, label: d.employeeCode ? `${d.name} (${d.employeeCode})` : d.name }))]}
                />
              )}

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Progress</p>
                <ol className="space-y-0">
                  {steps.map((s, n) => (
                    <li key={s.label} className="relative flex gap-3 pb-4 last:pb-0">
                      {n < steps.length - 1 && (
                        <span className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-0.5 ${steps[n + 1].state === 'done' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                      )}
                      <span className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${STEP_DOT[s.state]}`}>
                        {s.state === 'done' ? <Check className="h-3 w-3" /> : s.state === 'skipped' ? <Minus className="h-3 w-3" /> : null}
                      </span>
                      <div className="min-w-0 text-xs">
                        <p className={`font-semibold ${s.state === 'todo' ? 'text-slate-400' : 'text-slate-900'}`}>
                          {s.label}
                          {s.state === 'current' && <span className="ml-2 font-normal text-blue-600">next</span>}
                        </p>
                        <p className="text-slate-500">
                          {s.at ? formatDateTime(s.at) : s.state === 'skipped' ? 'Skipped' : s.state === 'current' || s.state === 'todo' ? 'Not yet' : ''}
                          {s.note ? ` · ${s.note}` : ''}
                          {n > 0 && sinceLabel(steps[n - 1].at, s.at) ? ` · ${sinceLabel(steps[n - 1].at, s.at)}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
            </div>
          );
        })()}
      </Modal>

      {/* PDI final check. Rendered after the detail so it opens on top of it. */}
      <Modal
        open={!!pdiItem}
        onClose={() => setPdiItem(null)}
        title="PDI final check"
        subtitle={pdiItem ? `${pdiItem.machine.serialNumber} · ${pdiItem.modelType} · ${pdiItem.planNo}${pdiItem.soNumber ? ` · SO ${pdiItem.soNumber}` : ''}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPdiItem(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => savePdi('HOLD')} disabled={pdiRemark.trim().length < 3} loading={pdiSaving}>Hold</Button>
            <Button variant="success" onClick={() => savePdi('PASS')} loading={pdiSaving} icon={<Check className="w-4 h-4" />}>Pass</Button>
          </>
        }
      >
        <div className="space-y-3">
          {pdiItem?.pdiStatus === 'HOLD' && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              On hold since {pdiItem.pdiAt ? formatDateTime(pdiItem.pdiAt) : '—'} by {pdiItem.pdiBy?.name ?? '—'}: {pdiItem.pdiRemark}
            </p>
          )}
          <p className="text-xs text-slate-600">
            Pass lets the machine go out of the main gate. Hold keeps it here until it is rectified and checked again.
          </p>
          <Input
            label="Remark (required for Hold)"
            value={pdiRemark}
            maxLength={500}
            onChange={(e) => setPdiRemark(e.target.value)}
            placeholder="What was checked, or what is wrong"
          />
          <p className="text-[11px] text-slate-500">Your name, the time and this remark are recorded.</p>
          {pdiError && <p className="text-xs font-medium text-red-700">{pdiError}</p>}
        </div>
      </Modal>

      <p className="text-[11px] text-slate-500">
        Click a serial number to see the machine details and its progress.
        A planned machine leaves the FG yard through the normal FG gate-out (driver badge and machine barcode); no exit request is needed.
        After FG gate-out, PDI does the final check: Pass, or Hold with a remark and check again after rectification.
        Main gate-out is allowed only after PDI passes the machine; it can be marked here or sent automatically by the main gate system.
        The time since FG gate-out turns red after {alertHours} hours, and the production manager is e-mailed.
      </p>
    </div>
  );
}

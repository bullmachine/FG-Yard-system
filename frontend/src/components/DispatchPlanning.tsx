'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { StatCard, SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { slotLabel, formatDateShort, formatDateTime } from '@/lib/format';
import { AlertTriangle, CheckCircle2, ClipboardList, Hourglass, Plus, RefreshCw, Repeat, Search, Trash2, XCircle } from 'lucide-react';

type PlanStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';

interface PlanMachine {
  id: string;
  serialNumber: string;
  model: string;
  parkStatus: string;
  yard: { id: string; name: string } | null;
  row: number | null;
  col: number | null;
}

interface Reservation {
  id: string;
  status: string;
  isOverride: boolean;
  overrideReason: string | null;
  inwardAt: string | null;
  machine: PlanMachine;
}

interface PlanLine {
  id: string;
  modelType: string;
  requestedQty: number;
  reservedQty: number;
  shortfall: number;
  reservations: Reservation[];
}

interface Plan {
  id: string;
  planNo: string;
  salesOrderNo: string;
  customerName: string;
  destination: string | null;
  plannedDate: string;
  notes: string | null;
  status: PlanStatus;
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  requestedQty: number;
  reservedQty: number;
  shortfall: number;
  lines: PlanLine[];
}

interface StockMachine {
  id: string;
  serialNumber: string;
  model: string;
  available: boolean;
  yard: { id: string; name: string } | null;
  row: number | null;
  col: number | null;
  inwardAt: string | null;
  daysInYard: number | null;
  fifoRank: number | null;
}

interface StockGroup {
  modelType: string;
  available: number;
  machines: StockMachine[];
}

const STATUS_META: Record<PlanStatus, { label: string; variant: 'amber' | 'green' | 'red' | 'gray' | 'blue' }> = {
  PENDING_APPROVAL: { label: 'Waiting approval', variant: 'amber' },
  APPROVED: { label: 'Approved', variant: 'green' },
  REJECTED: { label: 'Rejected', variant: 'red' },
  CANCELLED: { label: 'Cancelled', variant: 'gray' },
  COMPLETED: { label: 'Completed', variant: 'blue' },
};

type Filter = 'OPEN' | PlanStatus | 'ALL';

const FILTERS: { value: Filter; label: string; match: (s: PlanStatus) => boolean; tone: string }[] = [
  { value: 'OPEN', label: 'Open', match: (s) => s === 'PENDING_APPROVAL' || s === 'APPROVED', tone: 'bg-blue-50 text-blue-700' },
  { value: 'PENDING_APPROVAL', label: 'Waiting approval', match: (s) => s === 'PENDING_APPROVAL', tone: 'bg-amber-50 text-amber-700' },
  { value: 'APPROVED', label: 'Approved', match: (s) => s === 'APPROVED', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'REJECTED', label: 'Rejected', match: (s) => s === 'REJECTED', tone: 'bg-red-50 text-red-700' },
  { value: 'CANCELLED', label: 'Cancelled', match: (s) => s === 'CANCELLED', tone: 'bg-slate-100 text-slate-600' },
  { value: 'ALL', label: 'All', match: () => true, tone: 'bg-slate-100 text-slate-700' },
];

interface DraftLine { modelType: string; qty: string }

const TEXTAREA = 'w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function location(m: { yard: { name: string } | null; row: number | null; col: number | null }) {
  if (!m.yard) return '—';
  return m.row !== null && m.col !== null ? `${m.yard.name} · ${slotLabel(m.row, m.col)}` : m.yard.name;
}

export default function DispatchPlanning() {
  const { user } = useAuth();
  const role = user?.role || '';
  const isManager = role === 'ADMIN' || role === 'YARD_MANAGER';
  const canPlan = isManager || role === 'PLANNER';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stock, setStock] = useState<StockGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New plan form
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ salesOrderNo: '', customerName: '', destination: '', plannedDate: todayInput(), notes: '' });
  const [lines, setLines] = useState<DraftLine[]>([{ modelType: '', qty: '1' }]);

  // Reject / cancel reason, and machine swap
  const [reasonFor, setReasonFor] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [swap, setSwap] = useState<{ line: PlanLine; reservation: Reservation } | null>(null);
  const [swapMachineId, setSwapMachineId] = useState('');
  const [swapReason, setSwapReason] = useState('');

  const fetchPlans = useCallback(async (): Promise<Plan[]> => {
    const res = await fetch(`${API_URL}/api/dispatch-plans`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`GET /api/dispatch-plans -> ${res.status}`);
    return res.json();
  }, [API_URL]);

  // State is only set from the promise callbacks, and a late response after the page
  // has closed is dropped.
  const load = useCallback((isCurrent: () => boolean = () => true) =>
    fetchPlans()
      .then((d) => { if (isCurrent()) { setPlans(d); setError(null); } })
      .catch((err) => {
        console.error('Failed to load dispatch plans:', err);
        if (isCurrent()) setError('Could not load dispatch plans. Check that the backend is running, then refresh.');
      })
      .finally(() => { if (isCurrent()) { setLoading(false); setRefreshing(false); } }),
  [fetchPlans]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  const loadStock = useCallback(() =>
    fetch(`${API_URL}/api/yard-stock`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStock(Array.isArray(d?.groups) ? d.groups : []))
      .catch(() => setStock([])),
  [API_URL]);

  const refresh = () => { setRefreshing(true); load(); };

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match;
    return plans.filter((p) => match(p.status) && (!term ||
      p.planNo.toLowerCase().includes(term) ||
      p.salesOrderNo.toLowerCase().includes(term) ||
      p.customerName.toLowerCase().includes(term) ||
      p.lines.some((l) => l.modelType.toLowerCase().includes(term) || l.reservations.some((r) => r.machine.serialNumber.toLowerCase().includes(term)))));
  }, [plans, filter, term]);

  const open = plans.filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'APPROVED');
  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const freeByType = useMemo(() => new Map(stock.map((g) => [g.modelType, g.available])), [stock]);

  // Replace one plan in the list with the server's latest copy.
  const applyPlan = (plan: Plan) => setPlans((prev) => {
    const i = prev.findIndex((p) => p.id === plan.id);
    if (i < 0) return [plan, ...prev];
    const next = [...prev];
    next[i] = plan;
    return next;
  });

  const call = async (path: string, body?: unknown): Promise<unknown | null> => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/dispatch-plans${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setActionError(data?.error || `Request failed (${res.status})`); return null; }
      return data;
    } catch {
      setActionError('Connection error - try again');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setForm({ salesOrderNo: '', customerName: '', destination: '', plannedDate: todayInput(), notes: '' });
    setLines([{ modelType: '', qty: '1' }]);
    setActionError(null);
    setCreating(true);
    loadStock();
  };

  const submitCreate = async () => {
    const data = await call('', {
      ...form,
      lines: lines.filter((l) => l.modelType).map((l) => ({ modelType: l.modelType, qty: Number(l.qty) })),
    }) as Plan | null;
    if (!data) return;
    applyPlan(data);
    setCreating(false);
    setSelectedId(data.id);
    setNotice(data.shortfall
      ? `${data.planNo} saved. ${data.reservedQty} of ${data.requestedQty} reserved; short by ${data.shortfall}.`
      : `${data.planNo} saved. All ${data.reservedQty} machines reserved (FIFO).`);
  };

  const refill = async (plan: Plan) => {
    const data = await call(`/${plan.id}/refill`) as { added: number; plan: Plan } | null;
    if (!data) return;
    applyPlan(data.plan);
    setNotice(data.added ? `${data.added} more machine${data.added === 1 ? '' : 's'} reserved.` : 'No free stock to add yet.');
  };

  const approve = async (plan: Plan) => {
    const data = await call(`/${plan.id}/approve`) as Plan | null;
    if (data) { applyPlan(data); setNotice(`${data.planNo} approved.`); }
  };

  const submitReason = async () => {
    if (!selected || !reasonFor) return;
    const data = await call(`/${selected.id}/${reasonFor}`, { reason }) as Plan | null;
    if (!data) return;
    applyPlan(data);
    setNotice(`${data.planNo} ${reasonFor === 'reject' ? 'rejected' : 'cancelled'}; its machines are free again.`);
    setReasonFor(null);
  };

  const openSwap = (line: PlanLine, reservation: Reservation) => {
    setSwap({ line, reservation });
    setSwapMachineId('');
    setSwapReason('');
    setActionError(null);
    loadStock();
  };

  const submitSwap = async () => {
    if (!selected || !swap) return;
    const data = await call(`/${selected.id}/reservations/${swap.reservation.id}/swap`, { machineId: swapMachineId, reason: swapReason }) as Plan | null;
    if (!data) return;
    applyPlan(data);
    setSwap(null);
    setNotice('Reserved machine changed. Recorded as a FIFO override.');
  };

  const draftValid = !!form.salesOrderNo.trim() && !!form.customerName.trim() && !!form.plannedDate &&
    lines.some((l) => l.modelType) && lines.every((l) => !l.modelType || (Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1));
  const swapCandidates = swap ? (stock.find((g) => g.modelType === swap.line.modelType)?.machines.filter((m) => m.available) ?? []) : [];

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dispatch Planning"
        description="Reserve yard stock against sales orders, oldest machine first (FIFO)"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh} icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}>
              Refresh
            </Button>
            {canPlan && <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>New Plan</Button>}
          </div>
        }
      />

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
      {notice && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900">×</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Waiting approval" value={plans.filter((p) => p.status === 'PENDING_APPROVAL').length} icon={<Hourglass className="w-4 h-4" />} color="amber" onClick={() => setFilter('PENDING_APPROVAL')} />
        <StatCard label="Approved" value={plans.filter((p) => p.status === 'APPROVED').length} icon={<CheckCircle2 className="w-4 h-4" />} color="green" onClick={() => setFilter('APPROVED')} />
        <StatCard label="Machines reserved" value={open.reduce((n, p) => n + p.reservedQty, 0)} icon={<ClipboardList className="w-4 h-4" />} color="purple" hint="On open plans" />
        <StatCard
          label="Shortfall"
          value={open.reduce((n, p) => n + p.shortfall, 0)}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={open.some((p) => p.shortfall > 0) ? 'red' : 'slate'}
          hint="Requested but no stock"
        />
      </div>

      <SectionCard
        title={`Plans (${visible.length})`}
        description="Click a plan to see its reserved machines"
        noPadding
        action={
          <div className="w-full sm:w-64">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Plan, sales order, customer, serial…"
              icon={<Search className="w-3.5 h-3.5" />}
              aria-label="Search plans"
            />
          </div>
        }
      >
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-3">
          {FILTERS.map((f) => {
            const count = plans.filter((p) => f.match(p.status)).length;
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : `${f.tone} hover:opacity-80`} ${count === 0 && !active ? 'opacity-50' : ''}`}
              >
                {f.label}
                <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-6 h-6 text-slate-400" />}
            title={term ? 'Nothing matches your search' : 'No plans here'}
            description={canPlan ? 'Click New Plan to reserve stock against a sales order' : 'Plans raised by the planning team appear here'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Plan</TableHeaderCell>
              <TableHeaderCell>Sales Order</TableHeaderCell>
              <TableHeaderCell>Customer</TableHeaderCell>
              <TableHeaderCell>Model-types</TableHeaderCell>
              <TableHeaderCell align="right">Reserved</TableHeaderCell>
              <TableHeaderCell>Dispatch Date</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id} onClick={() => { setSelectedId(p.id); setActionError(null); }} className="cursor-pointer">
                  <TableCell>
                    <span className="font-medium text-slate-900">{p.planNo}</span>
                    <span className="block text-[11px] text-slate-500">{p.createdBy.name}</span>
                  </TableCell>
                  <TableCell className="text-[13px]">{p.salesOrderNo}</TableCell>
                  <TableCell className="text-[13px]">
                    {p.customerName}
                    {p.destination && <span className="block text-[11px] text-slate-500">{p.destination}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">{p.lines.map((l) => `${l.modelType} × ${l.requestedQty}`).join(', ')}</TableCell>
                  <TableCell align="right" className="tabular-nums">
                    <span className="font-semibold">{p.reservedQty}</span>
                    <span className="text-slate-500"> / {p.requestedQty}</span>
                    {p.shortfall > 0 && p.status !== 'REJECTED' && p.status !== 'CANCELLED' && (
                      <span className="block text-[11px] font-medium text-red-700">short {p.shortfall}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[13px]">{formatDateShort(p.plannedDate)}</TableCell>
                  <TableCell><Badge variant={STATUS_META[p.status].variant}>{STATUS_META[p.status].label}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* Plan detail */}
      <Modal
        open={!!selected && !reasonFor && !swap}
        onClose={() => setSelectedId(null)}
        title={selected ? `${selected.planNo} · SO ${selected.salesOrderNo}` : undefined}
        subtitle={selected ? `${selected.customerName}${selected.destination ? ` · ${selected.destination}` : ''} · dispatch ${formatDateShort(selected.plannedDate)}` : undefined}
        size="xl"
        footer={selected && (
          <>
            {canPlan && (
              (selected.status === 'PENDING_APPROVAL' || (selected.status === 'APPROVED' && isManager)) && (
                <Button variant="ghost" onClick={() => { setReason(''); setActionError(null); setReasonFor('cancel'); }} disabled={busy}>Cancel Plan</Button>
              )
            )}
            {canPlan && selected.status === 'PENDING_APPROVAL' && selected.shortfall > 0 && (
              <Button variant="secondary" onClick={() => refill(selected)} loading={busy}>Reserve Shortfall</Button>
            )}
            {isManager && selected.status === 'PENDING_APPROVAL' && (
              <>
                <Button variant="danger" onClick={() => { setReason(''); setActionError(null); setReasonFor('reject'); }} disabled={busy} icon={<XCircle className="w-4 h-4" />}>Reject</Button>
                <Button variant="success" onClick={() => approve(selected)} loading={busy} icon={<CheckCircle2 className="w-4 h-4" />}>Approve</Button>
              </>
            )}
          </>
        )}
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <Badge variant={STATUS_META[selected.status].variant}>{STATUS_META[selected.status].label}</Badge>
              <span>Raised by {selected.createdBy.name} on {formatDateTime(selected.createdAt)}</span>
              {selected.approvedBy && selected.approvedAt && (
                <span>{selected.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {selected.approvedBy.name} on {formatDateTime(selected.approvedAt)}</span>
              )}
            </div>
            {selected.rejectReason && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">Rejected: {selected.rejectReason}</p>}
            {selected.cancelReason && <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">Cancelled: {selected.cancelReason}</p>}
            {selected.notes && <p className="text-xs text-slate-600">Notes: {selected.notes}</p>}
            {selected.status === 'PENDING_APPROVAL' && selected.shortfall > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Short by {selected.shortfall}. There was not enough free stock when the plan was saved. Use Reserve Shortfall once more machines are parked and verified.
              </p>
            )}

            {selected.lines.map((l) => (
              <div key={l.id} className="rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="text-[13px] font-semibold text-slate-900">{l.modelType}</span>
                  <span className="text-xs tabular-nums text-slate-600">
                    {l.reservedQty} of {l.requestedQty} reserved
                    {l.shortfall > 0 && selected.status !== 'REJECTED' && selected.status !== 'CANCELLED' && <span className="ml-2 font-medium text-red-700">short {l.shortfall}</span>}
                  </span>
                </div>
                {l.reservations.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500">
                    {selected.status === 'REJECTED' || selected.status === 'CANCELLED' ? 'Machines released.' : 'No free stock of this model-type yet.'}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableHeaderCell>Serial Number</TableHeaderCell>
                      <TableHeaderCell>Model</TableHeaderCell>
                      <TableHeaderCell>Location</TableHeaderCell>
                      <TableHeaderCell>Inward Date</TableHeaderCell>
                      <TableHeaderCell>Pick</TableHeaderCell>
                      {canPlan && selected.status === 'PENDING_APPROVAL' && <TableHeaderCell align="right"> </TableHeaderCell>}
                    </TableHeader>
                    <TableBody>
                      {l.reservations.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell><span className="font-medium text-slate-900">{r.machine.serialNumber}</span></TableCell>
                          <TableCell className="text-xs text-slate-600">{r.machine.model}</TableCell>
                          <TableCell className="text-[13px]">{location(r.machine)}</TableCell>
                          <TableCell className="text-[13px]">{r.inwardAt ? formatDateShort(r.inwardAt) : '—'}</TableCell>
                          <TableCell>
                            {r.isOverride
                              ? <span title={r.overrideReason || ''}><Badge variant="orange">Override</Badge><span className="ml-1.5 text-[11px] text-slate-500">{r.overrideReason}</span></span>
                              : <Badge variant="green">FIFO</Badge>}
                          </TableCell>
                          {canPlan && selected.status === 'PENDING_APPROVAL' && (
                            <TableCell align="right">
                              <Button size="sm" variant="ghost" onClick={() => openSwap(l, r)} icon={<Repeat className="w-3.5 h-3.5" />}>Change</Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
            {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
          </div>
        )}
      </Modal>

      {/* New plan */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New Dispatch Plan"
        subtitle="Machines are reserved oldest first (FIFO) when you save"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={!draftValid} loading={busy}>Save &amp; Reserve</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Sales order number *" value={form.salesOrderNo} maxLength={50} onChange={(e) => setForm({ ...form, salesOrderNo: e.target.value })} />
            <Input label="Customer / dealer *" value={form.customerName} maxLength={120} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            <Input label="Destination" value={form.destination} maxLength={120} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
            <Input label="Planned dispatch date *" type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700">Model-types and quantity *</p>
            {lines.map((l, i) => {
              const free = l.modelType ? freeByType.get(l.modelType) ?? 0 : null;
              const qty = Number(l.qty);
              return (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={l.modelType}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, modelType: e.target.value } : x)))}
                      placeholder="Choose model-type"
                      options={stock.map((g) => ({ value: g.modelType, label: `${g.modelType} (${g.available} free)` }))}
                      aria-label={`Model-type for line ${i + 1}`}
                    />
                    {free !== null && qty > free && (
                      <p className="mt-1 text-[11px] text-amber-700">Only {free} free. The plan will be short by {qty - free}.</p>
                    )}
                  </div>
                  <div className="w-24">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={l.qty}
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                      aria-label={`Quantity for line ${i + 1}`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ modelType: '', qty: '1' }])}
                    aria-label={`Remove line ${i + 1}`}
                    icon={<Trash2 className="w-4 h-4" />}
                  />
                </div>
              );
            })}
            {lines.length < 20 && (
              <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { modelType: '', qty: '1' }])} icon={<Plus className="w-3.5 h-3.5" />}>
                Add model-type
              </Button>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={1000} className={TEXTAREA} />
          </div>
          {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
        </div>
      </Modal>

      {/* Reject / cancel reason */}
      <Modal
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        title={reasonFor === 'reject' ? 'Reject plan' : 'Cancel plan'}
        subtitle={selected ? `${selected.planNo} · SO ${selected.salesOrderNo}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReasonFor(null)}>Back</Button>
            <Button variant="danger" onClick={submitReason} disabled={reason.trim().length < 3} loading={busy}>
              {reasonFor === 'reject' ? 'Reject Plan' : 'Cancel Plan'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-xs text-slate-600">All machines held by this plan become free stock again.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={190} placeholder="Reason (required)" className={TEXTAREA} />
          {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
        </div>
      </Modal>

      {/* Swap a reserved machine */}
      <Modal
        open={!!swap}
        onClose={() => setSwap(null)}
        title="Change reserved machine"
        subtitle={swap ? `${swap.line.modelType} · replacing ${swap.reservation.machine.serialNumber}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSwap(null)}>Back</Button>
            <Button onClick={submitSwap} disabled={!swapMachineId || swapReason.trim().length < 5} loading={busy}>Change Machine</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Choosing a machine out of FIFO order is recorded as an override with your reason, and is visible to the Yard Manager.
          </p>
          {swapCandidates.length === 0 ? (
            <p className="text-xs text-slate-500">No other free {swap?.line.modelType} machine in the yard.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader>
                  <TableHeaderCell align="center">FIFO</TableHeaderCell>
                  <TableHeaderCell>Serial Number</TableHeaderCell>
                  <TableHeaderCell>Location</TableHeaderCell>
                  <TableHeaderCell>Inward Date</TableHeaderCell>
                  <TableHeaderCell align="right">Days</TableHeaderCell>
                </TableHeader>
                <TableBody>
                  {swapCandidates.map((m) => (
                    <TableRow key={m.id} onClick={() => setSwapMachineId(m.id)} className={`cursor-pointer ${swapMachineId === m.id ? 'bg-blue-50' : ''}`}>
                      <TableCell align="center">
                        <input type="radio" name="swap-machine" checked={swapMachineId === m.id} onChange={() => setSwapMachineId(m.id)} aria-label={`Choose ${m.serialNumber}`} className="mr-1.5 align-middle" />
                        <span className="text-xs text-slate-600">{m.fifoRank ?? '—'}</span>
                      </TableCell>
                      <TableCell><span className="font-medium text-slate-900">{m.serialNumber}</span></TableCell>
                      <TableCell className="text-[13px]">{location(m)}</TableCell>
                      <TableCell className="text-[13px]">{m.inwardAt ? formatDateShort(m.inwardAt) : '—'}</TableCell>
                      <TableCell align="right" className="tabular-nums">{m.daysInYard ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <textarea value={swapReason} onChange={(e) => setSwapReason(e.target.value)} rows={2} maxLength={190} placeholder="Reason for the change (required), e.g. customer asked for this serial" className={TEXTAREA} />
          {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
        </div>
      </Modal>
    </div>
  );
}

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
import { formatDateShort, formatDateTime } from '@/lib/format';
import { DISPATCH_STATUS, DispatchItem, DispatchProgress, dispatchLocation } from '@/components/DispatchList';
import { Boxes, ClipboardList, PackageCheck, Plus, RefreshCw, Search, Trash2, Truck, X } from 'lucide-react';

interface Plan {
  id: string;
  planNo: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  lines: { id: string; modelType: string; requestedQty: number }[];
  totalQty: number;
  counts: { planned: number; outOfYard: number; mainGateOut: number; cancelled: number };
  items: DispatchItem[];
}

interface StockMachine {
  id: string;
  serialNumber: string;
  available: boolean;
  fifoRank: number | null;
  inwardAt: string | null;
  daysInYard: number | null;
  returnedAt: string | null;
  yard: { name: string } | null;
  row: number | null;
  col: number | null;
}

interface StockGroup { modelType: string; available: number; machines: StockMachine[] }

interface DraftLine { modelType: string; qty: string }

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DispatchPlanning() {
  const { user } = useAuth();
  const role = user?.role || '';
  const canPlan = role === 'ADMIN' || role === 'YARD_MANAGER' || role === 'PLANNER';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [stock, setStock] = useState<StockGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ modelType: '', qty: '1' }]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const refresh = () => { setRefreshing(true); load(); };

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => plans.filter((p) => !term ||
    p.planNo.toLowerCase().includes(term) ||
    p.lines.some((l) => l.modelType.toLowerCase().includes(term)) ||
    p.items.some((i) => i.machine.serialNumber.toLowerCase().includes(term))), [plans, term]);

  const selected = plans.find((p) => p.id === selectedId) ?? null;
  const freeByType = useMemo(() => new Map(stock.map((g) => [g.modelType, g.available])), [stock]);
  const totals = plans.reduce((t, p) => ({
    planned: t.planned + p.counts.planned,
    outOfYard: t.outOfYard + p.counts.outOfYard,
    mainGateOut: t.mainGateOut + p.counts.mainGateOut,
  }), { planned: 0, outOfYard: 0, mainGateOut: 0 });

  const post = async (path: string, body?: unknown): Promise<unknown | null> => {
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
    setLines([{ modelType: '', qty: '1' }]);
    setActionError(null);
    setCreating(true);
    fetch(`${API_URL}/api/yard-stock`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStock(Array.isArray(d?.groups) ? d.groups.filter((g: StockGroup) => g.available > 0) : []))
      .catch(() => setStock([]));
  };

  const submitCreate = async () => {
    const data = await post('', { lines: lines.filter((l) => l.modelType).map((l) => ({ modelType: l.modelType, qty: Number(l.qty) })) }) as Plan | null;
    if (!data) return;
    setPlans((prev) => [data, ...prev]);
    setCreating(false);
    setSelectedId(data.id);
    setNotice(`${data.planNo} saved. ${data.totalQty} machine${data.totalQty === 1 ? '' : 's'} planned (oldest first) and sent to the PDI dispatch list.`);
  };

  const cancelItem = async (item: DispatchItem) => {
    if (!window.confirm(`Remove ${item.machine.serialNumber} from the dispatch plan? It goes back to free stock.`)) return;
    if (!(await post(`/items/${item.id}/cancel`))) return;
    setRefreshing(true);
    await load();
  };

  const cancelPlan = async (plan: Plan) => {
    if (!window.confirm(`Cancel every machine of ${plan.planNo} that is still in the FG yard? They go back to free stock.`)) return;
    const data = await post(`/${plan.id}/cancel`) as { cancelled: number; plan: Plan } | null;
    if (!data) return;
    setPlans((prev) => prev.map((p) => (p.id === data.plan.id ? data.plan : p)));
    setNotice(`${data.cancelled} machine${data.cancelled === 1 ? '' : 's'} of ${plan.planNo} cancelled.`);
  };

  // A line may not ask for more than the free stock; the server refuses it anyway.
  const lineError = (l: DraftLine) => {
    if (!l.modelType) return null;
    const qty = Number(l.qty);
    const free = freeByType.get(l.modelType) ?? 0;
    if (!Number.isInteger(qty) || qty < 1) return 'Enter a whole number';
    const sameType = lines.filter((x) => x.modelType === l.modelType).reduce((n, x) => n + (Number(x.qty) || 0), 0);
    return sameType > free ? `Only ${free} free in the FG yard` : null;
  };
  const draftValid = lines.some((l) => l.modelType) && lines.every((l) => !lineError(l));

  // The machines the server will pick: per model-type, the oldest free ones (FIFO 1, 2, ...).
  const preview = [...lines.reduce((m, l) => (l.modelType ? m.set(l.modelType, (m.get(l.modelType) ?? 0) + (Number(l.qty) || 0)) : m), new Map<string, number>())]
    .flatMap(([modelType, qty]) => (stock.find((g) => g.modelType === modelType)?.machines ?? [])
      .filter((m) => m.available)
      .sort((a, b) => (a.fifoRank ?? 0) - (b.fifoRank ?? 0))
      .slice(0, Math.max(0, qty))
      .map((m) => ({ ...m, modelType })));

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dispatch Planning"
        description="Plan FG yard machines for dispatch. The oldest machines are picked first (FIFO)."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh} icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}>Refresh</Button>
            {canPlan && <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>Plan Machines</Button>}
          </div>
        }
      />

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>}
      {notice && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Plans" value={plans.length} icon={<ClipboardList className="w-4 h-4" />} color="indigo" hint="Last 200" />
        <StatCard label="Waiting in FG yard" value={totals.planned} icon={<Boxes className="w-4 h-4" />} color="purple" hint="Planned, not yet out" />
        <StatCard label="Waiting main gate" value={totals.outOfYard} icon={<PackageCheck className="w-4 h-4" />} color="amber" hint="Out of the FG yard" />
        <StatCard label="Main gate out" value={totals.mainGateOut} icon={<Truck className="w-4 h-4" />} color="green" hint="Left the plant" />
      </div>

      <SectionCard
        title={`Plans (${visible.length})`}
        description="Click a plan to see its machines"
        noPadding
        action={
          <div className="w-full sm:w-64">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Plan, model-type, serial…" icon={<Search className="w-3.5 h-3.5" />} aria-label="Search plans" />
          </div>
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-6 h-6 text-slate-400" />}
            title={term ? 'Nothing matches your search' : 'No dispatch plans yet'}
            description={canPlan ? 'Click Plan Machines to pick machines for dispatch' : 'Plans from the planning team appear here'}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Plan</TableHeaderCell>
              <TableHeaderCell>Model-types</TableHeaderCell>
              <TableHeaderCell align="right">In FG yard</TableHeaderCell>
              <TableHeaderCell align="right">Waiting main gate</TableHeaderCell>
              <TableHeaderCell align="right">Main gate out</TableHeaderCell>
              <TableHeaderCell align="right">Cancelled</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id} onClick={() => { setSelectedId(p.id); setActionError(null); }} className="cursor-pointer">
                  <TableCell>
                    <span className="font-medium text-slate-900">{p.planNo}</span>
                    <span className="block text-[11px] text-slate-500">{p.createdBy.name} · {formatDateShort(p.createdAt)}</span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">{p.lines.map((l) => `${l.modelType} × ${l.requestedQty}`).join(', ')}</TableCell>
                  <TableCell align="right" className="tabular-nums font-semibold text-violet-700">{p.counts.planned || '—'}</TableCell>
                  <TableCell align="right" className="tabular-nums">{p.counts.outOfYard || '—'}</TableCell>
                  <TableCell align="right" className="tabular-nums text-emerald-700">{p.counts.mainGateOut || '—'}</TableCell>
                  <TableCell align="right" className="tabular-nums text-slate-500">{p.counts.cancelled || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* Plan detail */}
      <Modal
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.planNo : undefined}
        subtitle={selected ? `Planned by ${selected.createdBy.name} on ${formatDateTime(selected.createdAt)}` : undefined}
        size="xl"
        footer={selected && canPlan && selected.counts.planned > 0 && (
          <Button variant="danger" onClick={() => cancelPlan(selected)} loading={busy}>Cancel Machines Still in Yard</Button>
        )}
      >
        {selected && (
          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableHeaderCell>Serial Number</TableHeaderCell>
                <TableHeaderCell>Model-type</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Inward Date</TableHeaderCell>
                <TableHeaderCell>Driver</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                {canPlan && <TableHeaderCell align="right"> </TableHeaderCell>}
              </TableHeader>
              <TableBody>
                {selected.items.map((i) => {
                  const meta = DISPATCH_STATUS[i.status];
                  const inYard = i.status === 'PLANNED' || i.status === 'DRIVER_ASSIGNED';
                  return (
                    <TableRow key={i.id} className={i.status === 'CANCELLED' ? 'opacity-60' : ''}>
                      <TableCell><span className="font-medium text-slate-900">{i.machine.serialNumber}</span></TableCell>
                      <TableCell className="text-xs text-slate-600">{i.modelType}</TableCell>
                      <TableCell className="text-[13px]">{inYard ? dispatchLocation(i.machine) : '—'}</TableCell>
                      <TableCell className="text-[13px]">{i.inwardAt ? formatDateShort(i.inwardAt) : '—'}</TableCell>
                      <TableCell className="text-[13px]">{i.driver?.name ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          {i.status !== 'CANCELLED' && <DispatchProgress item={i} />}
                        </div>
                      </TableCell>
                      {canPlan && (
                        <TableCell align="right">
                          {inYard && (
                            <Button size="sm" variant="ghost" onClick={() => cancelItem(i)} disabled={busy} icon={<X className="w-3.5 h-3.5" />}>Cancel</Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
          </div>
        )}
      </Modal>

      {/* New plan */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Plan Machines for Dispatch"
        subtitle="The oldest free machines of each model-type are picked when you save"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={!draftValid} loading={busy}>Save Plan</Button>
          </>
        }
      >
        <div className="space-y-2">
          {stock.length === 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">There is no free stock in the FG yard to plan.</p>
          )}
          {lines.map((l, i) => {
            const err = lineError(l);
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
                  {err && <p className="mt-1 text-[11px] font-medium text-red-700">{err}</p>}
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    min={1}
                    max={l.modelType ? freeByType.get(l.modelType) : undefined}
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
          {stock.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { modelType: '', qty: '1' }])} icon={<Plus className="w-3.5 h-3.5" />}>
              Add model-type
            </Button>
          )}
          {preview.length > 0 && (
            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                These {preview.length} machine{preview.length === 1 ? '' : 's'} will be planned (oldest first)
              </p>
              <div className="max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableHeaderCell align="center">FIFO</TableHeaderCell>
                    <TableHeaderCell>Serial Number</TableHeaderCell>
                    <TableHeaderCell>Model-type</TableHeaderCell>
                    <TableHeaderCell>Location</TableHeaderCell>
                    <TableHeaderCell align="right">Age (first inward)</TableHeaderCell>
                  </TableHeader>
                  <TableBody>
                    {preview.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell align="center" className="tabular-nums text-xs">{m.fifoRank ?? '—'}</TableCell>
                        <TableCell>
                          <span className="font-medium text-slate-900">{m.serialNumber}</span>
                          {m.returnedAt && (
                            <span className="ml-1.5 rounded bg-blue-50 px-1 py-0.5 text-[10px] font-semibold text-blue-700" title={`Left the yard and came back in on ${new Date(m.returnedAt).toLocaleDateString('en-IN')}`}>
                              Returned
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">{m.modelType}</TableCell>
                        <TableCell className="text-[13px]">{dispatchLocation(m)}</TableCell>
                        <TableCell align="right" className="tabular-nums">{m.daysInYard ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {actionError && <p className="text-xs font-medium text-red-700">{actionError}</p>}
        </div>
      </Modal>
    </div>
  );
}

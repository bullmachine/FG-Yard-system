'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { StatCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { formatDateShort, formatDateTime } from '@/lib/format';
import { DispatchItem, DispatchProgress, dispatchLocation, dispatchStatusMeta } from '@/components/DispatchList';
import { Boxes, ClipboardList, PackageCheck, Plus, RefreshCw, Search, Trash2, Truck, X } from 'lucide-react';

interface Plan {
  id: string;
  planNo: string;
  soNumber: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  lines: { id: string; modelType: string; requestedQty: number }[];
  totalQty: number;
  counts: { planned: number; outOfYard: number; mainGateOut: number; cancelled: number };
  items: DispatchItem[];
}

type PlanView = 'open' | 'completed' | 'cancelled' | 'all';

interface PlansResponse {
  plans: Plan[];
  total: number;
  page: number;
  pageSize: number;
  views: Record<PlanView, number>;
  summary: { openPlans: number; inYard: number; outOfYard: number; mainGateOutToday: number };
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

const VIEWS: { value: PlanView; label: string; hint: string; tone: string }[] = [
  { value: 'open', label: 'Open', hint: 'Some machines not yet out of the main gate', tone: 'bg-violet-50 text-violet-700' },
  { value: 'completed', label: 'Completed', hint: 'Every machine out of the main gate', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Every machine cancelled', tone: 'bg-slate-100 text-slate-600' },
  { value: 'all', label: 'All', hint: 'Every plan', tone: 'bg-slate-100 text-slate-700' },
];

// What each summary card lists. The statuses match the card counts from the backend.
type CardKey = 'IN_YARD' | 'OUT_OF_YARD' | 'MAIN_GATE_OUT';
const CARD_LISTS: Record<CardKey, { title: string; subtitle: string; statuses: DispatchItem['status'][] }> = {
  IN_YARD: { title: 'Waiting in FG yard', subtitle: 'Planned, not yet out of the FG yard', statuses: ['PLANNED', 'DRIVER_ASSIGNED'] },
  OUT_OF_YARD: { title: 'Waiting main gate', subtitle: 'Out of the FG yard, not yet out of the main gate', statuses: ['OUT_OF_YARD'] },
  MAIN_GATE_OUT: { title: 'Out of plant today', subtitle: 'Out of the main gate since midnight', statuses: ['MAIN_GATE_OUT'] },
};

// Machines still to move come first in a plan.
const STATUS_ORDER: Record<DispatchItem['status'], number> = { PLANNED: 0, DRIVER_ASSIGNED: 0, OUT_OF_YARD: 1, MAIN_GATE_OUT: 2, CANCELLED: 3 };

/** Where the plan stands, from the step its slowest machine is at. */
function planState(p: Plan): { label: string; variant: 'purple' | 'amber' | 'green' | 'gray'; hint: string } {
  if (p.counts.planned > 0) return { label: 'In FG yard', variant: 'purple', hint: `${p.counts.planned} machine${p.counts.planned === 1 ? '' : 's'} still to leave the FG yard` };
  if (p.counts.outOfYard > 0) return { label: 'At PDI / main gate', variant: 'amber', hint: `${p.counts.outOfYard} machine${p.counts.outOfYard === 1 ? '' : 's'} out of the FG yard, at PDI or waiting at the main gate` };
  if (p.counts.mainGateOut > 0) return { label: 'Completed', variant: 'green', hint: 'Every machine is out of the main gate' };
  return { label: 'Cancelled', variant: 'gray', hint: 'Every machine was cancelled' };
}

/** One bar per plan: out of plant, waiting main gate, still in the FG yard. Cancelled machines are left out. */
function PlanProgress({ plan }: { plan: Plan }) {
  const { planned, outOfYard, mainGateOut, cancelled } = plan.counts;
  const live = plan.totalQty - cancelled;
  if (live === 0) return <span className="text-xs text-slate-400">All {cancelled} cancelled</span>;
  return (
    <div className="w-40 space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {[[mainGateOut, 'bg-emerald-500'], [outOfYard, 'bg-amber-400'], [planned, 'bg-violet-400']].map(([n, cls]) => (n as number) > 0 && (
          <span key={cls as string} className={cls as string} style={{ width: `${((n as number) / live) * 100}%` }} />
        ))}
      </div>
      <p className="text-[11px] text-slate-600 tabular-nums">
        <span className="font-semibold text-slate-900">{mainGateOut}</span> of {live} out of plant
        {cancelled > 0 && <span className="text-slate-400"> · {cancelled} cancelled</span>}
      </p>
    </div>
  );
}

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DispatchPlanning() {
  const { user } = useAuth();
  const role = user?.role || '';
  const canPlan = role === 'ADMIN' || role === 'YARD_MANAGER' || role === 'PLANNER';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [data, setData] = useState<PlansResponse | null>(null);
  const [view, setView] = useState<PlanView>('open');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [stock, setStock] = useState<StockGroup[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [cardList, setCardList] = useState<CardKey | null>(null);
  const [cardItems, setCardItems] = useState<DispatchItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ modelType: '', qty: '1' }]);
  const [soNumber, setSoNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Search runs on the server, so wait for the user to stop typing. Any new filter
  // starts again from the first page.
  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const t = setTimeout(() => { setQuery(next); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, query]);

  const changeView = (v: PlanView) => { setView(v); setPage(1); };
  const changeFrom = (v: string) => { setFrom(v); setPage(1); };
  const changeTo = (v: string) => { setTo(v); setPage(1); };
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };

  const fetchPlans = useCallback(async (): Promise<PlansResponse> => {
    const qs = new URLSearchParams({ view, page: String(page), pageSize: String(pageSize) });
    if (query) qs.set('q', query);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await fetch(`${API_URL}/api/dispatch-plans?${qs}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`GET /api/dispatch-plans -> ${res.status}`);
    return res.json();
  }, [API_URL, view, page, pageSize, query, from, to]);

  // State is only set from the promise callbacks, and a response for filters that have
  // since changed is dropped.
  const load = useCallback((isCurrent: () => boolean = () => true) =>
    fetchPlans()
      .then((d) => { if (isCurrent()) { setData(d); setError(null); } })
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

  const openPlan = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/dispatch-plans/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET /api/dispatch-plans/${id} -> ${res.status}`);
      setSelected(await res.json());
    } catch (err) {
      console.error('Failed to load dispatch plan:', err);
      setError('Could not open the plan. Refresh and try again.');
    }
  };

  const openCard = (key: CardKey) => {
    setCardList(key);
    setCardItems(null);
    const qs = new URLSearchParams({ status: CARD_LISTS[key].statuses.join(',') });
    if (key === 'MAIN_GATE_OUT') {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      qs.set('outSince', midnight.toISOString());
    }
    fetch(`${API_URL}/api/dispatch-plans/items?${qs}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCardItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => setCardItems([]));
  };

  const clearFilters = () => {
    setSearch('');
    setQuery('');
    changeFrom('');
    changeTo('');
  };

  const showView = (v: PlanView) => {
    changeView(v);
    clearFilters();
  };

  const filtered = !!(query || from || to);
  const summary = data?.summary;
  const plans = data?.plans ?? [];
  const freeByType = useMemo(() => new Map(stock.map((g) => [g.modelType, g.available])), [stock]);
  const selectedItems = useMemo(() => (selected ? [...selected.items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) : []), [selected]);

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
    setSoNumber('');
    setActionError(null);
    setCreating(true);
    fetch(`${API_URL}/api/yard-stock`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStock(Array.isArray(d?.groups) ? d.groups.filter((g: StockGroup) => g.available > 0) : []))
      .catch(() => setStock([]));
  };

  const submitCreate = async () => {
    const data = await post('', {
      soNumber: soNumber.trim() || undefined,
      lines: lines.filter((l) => l.modelType).map((l) => ({ modelType: l.modelType, qty: Number(l.qty) })),
    }) as Plan | null;
    if (!data) return;
    setCreating(false);
    setSelected(data);
    setNotice(`${data.planNo}${data.soNumber ? ` (SO ${data.soNumber})` : ''} saved. ${data.totalQty} machine${data.totalQty === 1 ? '' : 's'} planned (oldest first) and sent to the PDI dispatch list.`);
    showView('open');
    setRefreshing(true);
    load();
  };

  const cancelItem = async (item: DispatchItem) => {
    if (!window.confirm(`Remove ${item.machine.serialNumber} from the dispatch plan? It goes back to free stock.`)) return;
    if (!(await post(`/items/${item.id}/cancel`))) return;
    await openPlan(item.planId);
    setRefreshing(true);
    await load();
  };

  const cancelPlan = async (plan: Plan) => {
    if (!window.confirm(`Cancel every machine of ${plan.planNo} that is still in the FG yard? They go back to free stock.`)) return;
    const data = await post(`/${plan.id}/cancel`) as { cancelled: number; plan: Plan } | null;
    if (!data) return;
    setSelected(data.plan);
    setNotice(`${data.cancelled} machine${data.cancelled === 1 ? '' : 's'} of ${plan.planNo} cancelled.`);
    setRefreshing(true);
    await load();
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
    <div className="space-y-3">
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

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard label="Open plans" value={summary.openPlans} icon={<ClipboardList />} color="indigo" hint="Not all out yet" onClick={() => showView('open')} />
          <StatCard label="Waiting in FG yard" value={summary.inYard} icon={<Boxes />} color="purple" hint="Not yet out of FG yard" onClick={() => openCard('IN_YARD')} />
          <StatCard label="Waiting main gate" value={summary.outOfYard} icon={<PackageCheck />} color="amber" hint="Not yet out of main gate" onClick={() => openCard('OUT_OF_YARD')} />
          <StatCard label="Out of plant today" value={summary.mainGateOutToday} icon={<Truck />} color="green" hint="Since midnight" onClick={() => openCard('MAIN_GATE_OUT')} />
        </div>
      )}

      {/* Tabs and filters share one toolbar so most of the screen is left for the list. */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {VIEWS.map((v) => {
              const n = data?.views[v.value] ?? 0;
              const active = view === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => changeView(v.value)}
                  title={v.hint}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : `${v.tone} hover:opacity-80`} ${n === 0 && !active ? 'opacity-50' : ''}`}
                >
                  {v.label}
                  <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <div className="w-full sm:w-52">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Plan, SO, model-type, serial…" icon={<Search className="w-3.5 h-3.5" />} aria-label="Search plans" />
            </div>
            <div className="w-36"><Input type="date" value={from} max={to || undefined} onChange={(e) => changeFrom(e.target.value)} aria-label="Planned from" title="Planned from" /></div>
            <span className="text-xs text-slate-400">to</span>
            <div className="w-36"><Input type="date" value={to} min={from || undefined} onChange={(e) => changeTo(e.target.value)} aria-label="Planned to" title="Planned to" /></div>
            {filtered && <Button variant="ghost" size="sm" onClick={clearFilters} icon={<X className="w-3.5 h-3.5" />}>Clear</Button>}
          </div>
        </div>

        {plans.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="w-6 h-6 text-slate-400" />}
            title={filtered ? 'Nothing matches your search' : view === 'open' ? 'No open plans' : 'No plans here'}
            description={filtered ? 'Try another plan, model-type, serial or date' : view === 'open' && canPlan ? 'Click Plan Machines to pick machines for dispatch' : 'Plans appear here as machines move'}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableHeaderCell>Plan</TableHeaderCell>
                <TableHeaderCell>Model-types</TableHeaderCell>
                <TableHeaderCell><span title="Bar: green = out of plant, amber = waiting main gate, violet = still in FG yard">Progress</span></TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {plans.map((p) => {
                  const st = planState(p);
                  return (
                    <TableRow key={p.id} onClick={() => { setSelected(p); setActionError(null); }} className="cursor-pointer">
                      <TableCell>
                        <span className="font-semibold text-slate-900">{p.planNo}</span>
                        {p.soNumber && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">SO {p.soNumber}</span>}
                        <span className="block text-[11px] text-slate-500">{p.createdBy.name} · {formatDateShort(p.createdAt)} · {daysAgo(p.createdAt)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {p.lines.map((l) => (
                            <span key={l.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                              {l.modelType} <span className="text-slate-500">× {l.requestedQty}</span>
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell><PlanProgress plan={p} /></TableCell>
                      <TableCell><span title={st.hint}><Badge variant={st.variant}>{st.label}</Badge></span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination total={data?.total ?? 0} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={changePageSize} pageSizes={[25, 50, 100]} />
          </>
        )}
      </div>

      {/* Card list. Rendered before the plan detail so a plan opened from it shows on top. */}
      <Modal
        open={!!cardList}
        onClose={() => setCardList(null)}
        title={cardList ? `${CARD_LISTS[cardList].title}${cardItems ? ` (${cardItems.length})` : ''}` : undefined}
        subtitle={cardList ? `${CARD_LISTS[cardList].subtitle} · click a row to open its plan` : undefined}
        size="xl"
        footer={<Button variant="secondary" onClick={() => setCardList(null)}>Close</Button>}
      >
        {cardItems === null ? (
          <p className="py-6 text-center text-xs text-slate-500">Loading…</p>
        ) : cardItems.length === 0 ? (
          <EmptyState icon={<Boxes className="w-6 h-6 text-slate-400" />} title="No machines" description="Nothing matches this card right now" />
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Plan</TableHeaderCell>
              <TableHeaderCell>Model-type</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Driver</TableHeaderCell>
              <TableHeaderCell>{cardList === 'IN_YARD' ? 'Planned' : cardList === 'OUT_OF_YARD' ? 'FG gate-out' : 'Main gate-out'}</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {cardItems.map((i) => {
                const meta = dispatchStatusMeta(i);
                const at = cardList === 'IN_YARD' ? i.plannedAt : cardList === 'OUT_OF_YARD' ? i.gateOutAt : i.mainGateOutAt;
                return (
                  <TableRow key={i.id} onClick={() => openPlan(i.planId)} className="cursor-pointer">
                    <TableCell>
                      <span className="font-medium text-slate-900">{i.machine.serialNumber}</span>
                      <span className="block text-[11px] text-slate-400">{i.machine.model}</span>
                    </TableCell>
                    <TableCell className="text-[13px]">{i.planNo}</TableCell>
                    <TableCell className="text-xs text-slate-600">{i.modelType}</TableCell>
                    <TableCell className="text-[13px]">{cardList === 'IN_YARD' ? dispatchLocation(i.machine) : '—'}</TableCell>
                    <TableCell className="text-[13px]">{i.driver?.name ?? '—'}</TableCell>
                    <TableCell className="text-[13px]">{at ? formatDateTime(at) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <DispatchProgress item={i} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Modal>

      {/* Plan detail */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.planNo : undefined}
        subtitle={selected ? `${selected.soNumber ? `SO ${selected.soNumber} · ` : ''}Planned by ${selected.createdBy.name} on ${formatDateTime(selected.createdAt)}` : undefined}
        size="xl"
        footer={selected && canPlan && selected.counts.planned > 0 && (
          <Button variant="danger" onClick={() => cancelPlan(selected)} loading={busy}>Cancel Machines Still in Yard</Button>
        )}
      >
        {selected && (() => {
          const st = planState(selected);
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={st.variant}>{st.label}</Badge>
                <span className="text-xs text-slate-600">{st.hint}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['In FG yard', selected.counts.planned, 'text-violet-700'],
                  ['Waiting main gate', selected.counts.outOfYard, 'text-amber-700'],
                  ['Out of plant', selected.counts.mainGateOut, 'text-emerald-700'],
                  ['Cancelled', selected.counts.cancelled, 'text-slate-500'],
                ].map(([label, n, cls]) => (
                  <div key={label as string} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className={`text-lg font-bold tabular-nums ${cls}`}>{n}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                Requested: {selected.lines.map((l) => `${l.modelType} × ${l.requestedQty}`).join(', ')}
              </p>
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
                  {selectedItems.map((i) => {
                    const meta = dispatchStatusMeta(i);
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
          );
        })()}
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
          <Input
            label="SO number (optional)"
            value={soNumber}
            maxLength={50}
            onChange={(e) => setSoNumber(e.target.value)}
            placeholder="Sales Order this plan is for"
          />
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

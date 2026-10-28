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
import { slotLabel, formatDateShort } from '@/lib/format';
import { Boxes, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Clock, Pencil, RefreshCw, Search, ShieldAlert } from 'lucide-react';

type InwardSource = 'ACTUAL' | 'GATE' | 'STAGE18' | 'UNKNOWN';

interface StockMachine {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string;
  fertCategory: string | null;
  parkStatus: string;
  verified: boolean;
  reservedFor: { planId: string; planNo: string } | null;
  exitPending: boolean;
  available: boolean;
  yard: { id: string; name: string } | null;
  row: number | null;
  col: number | null;
  inwardAt: string | null;
  inwardSource: InwardSource;
  daysInYard: number | null;
  returnedAt: string | null;
  returnHoldAt: string | null;
  fifoRank: number | null;
}

interface StockGroup {
  modelType: string;
  available: number;
  reserved: number;
  onHold: number;
  pendingVerify: number;
  returnHold: number;
  total: number;
  oldestInwardAt: string | null;
  oldestDays: number | null;
  machines: StockMachine[];
}

interface StockResponse {
  generatedAt: string;
  totals: { available: number; reserved: number; onHold: number; pendingVerify: number; returnHold: number; total: number; modelTypes: number; undated: number; estimated: number };
  groups: StockGroup[];
}

// How the FIFO date was obtained. "Stage 18" and "Unknown" are estimates, so they
// are flagged for a manager to replace with the real inward date.
const SOURCE_META: Record<InwardSource, { label: string; variant: 'green' | 'blue' | 'amber' | 'gray'; hint: string }> = {
  ACTUAL: { label: 'Actual', variant: 'green', hint: 'Real inward date entered by hand' },
  GATE: { label: 'Gate', variant: 'blue', hint: 'First gate check-in' },
  STAGE18: { label: 'Stage 18', variant: 'amber', hint: 'Estimated from the stage 18 completion date' },
  UNKNOWN: { label: 'Unknown', variant: 'gray', hint: 'No date available' },
};

function location(m: { yard: { name: string } | null; row: number | null; col: number | null }) {
  if (!m.yard) return '—';
  return m.row !== null && m.col !== null ? `${m.yard.name} · ${slotLabel(m.row, m.col)}` : m.yard.name;
}

/** The machine's dispatch status in plain words. */
function stockStatus(m: StockMachine): { label: string; variant: 'green' | 'purple' | 'orange' | 'amber' | 'red'; hint: string } {
  if (m.reservedFor) return { label: `Planned · ${m.reservedFor.planNo}`, variant: 'purple', hint: 'Planned for dispatch; waiting to go out' };
  if (m.exitPending) return { label: 'Exit request', variant: 'orange', hint: 'Has an open exit request (testing, repair, ...)' };
  if (m.parkStatus === 'PARKED_REJECTED') return { label: 'Rejected by security', variant: 'red', hint: 'Security rejected the parking; the yard manager must sort it out' };
  if (!m.verified) return { label: 'Waiting security check', variant: 'amber', hint: 'Parked but not yet verified by security' };
  if (m.returnHoldAt) return { label: 'On hold · returned', variant: 'red', hint: 'Came back after dispatch; must be checked and cleared before it can be planned' };
  return { label: 'Free', variant: 'green', hint: 'Parked, verified and ready to plan for dispatch' };
}

// What each summary card lists. Each filter matches how the backend counts that total.
type CardKey = 'FREE' | 'PLANNED' | 'UNVERIFIED' | 'ESTIMATED' | 'RETURN_HOLD';
const CARD_LISTS: Record<CardKey, { title: string; subtitle: string; match: (m: StockMachine) => boolean }> = {
  FREE: { title: 'Free stock', subtitle: 'Verified, not planned, no exit request · dispatch order', match: (m) => m.available },
  PLANNED: { title: 'Planned for dispatch', subtitle: 'Reserved on a dispatch plan, still in the yard', match: (m) => !!m.reservedFor },
  UNVERIFIED: { title: 'Awaiting verification', subtitle: 'In a slot, not yet checked by security', match: (m) => !m.verified && !m.reservedFor },
  ESTIMATED: { title: 'Estimated dates', subtitle: 'FIFO date taken from stage 18 or unknown', match: (m) => m.inwardSource === 'STAGE18' || m.inwardSource === 'UNKNOWN' },
  RETURN_HOLD: { title: 'On hold · returned', subtitle: 'Came back after dispatch; must be cleared before planning', match: (m) => m.verified && !m.reservedFor && !m.exitPending && !!m.returnHoldAt },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function YardStock() {
  const { user } = useAuth();
  const canEditDate = user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const [data, setData] = useState<StockResponse | null>(null);
  const [yards, setYards] = useState<{ id: string; name: string }[]>([]);
  const [yardId, setYardId] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<StockMachine | null>(null);
  const [cardList, setCardList] = useState<CardKey | null>(null);
  const [editing, setEditing] = useState<StockMachine | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [clearing, setClearing] = useState<StockMachine | null>(null);
  const [clearRemark, setClearRemark] = useState('');
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearSaving, setClearSaving] = useState(false);

  const fetchStock = useCallback(async (): Promise<StockResponse> => {
    const qs = yardId ? `?yardId=${encodeURIComponent(yardId)}` : '';
    const res = await fetch(`${API_URL}/api/yard-stock${qs}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`GET /api/yard-stock -> ${res.status}`);
    return res.json();
  }, [API_URL, yardId]);

  // State is only set from the promise callbacks, and a response for a yard filter
  // that has since changed is dropped.
  const load = useCallback((isCurrent: () => boolean = () => true) =>
    fetchStock()
      .then((d) => { if (isCurrent()) { setData(d); setError(null); } })
      .catch((err) => {
        console.error('Failed to load yard stock:', err);
        if (isCurrent()) setError('Could not load yard stock. Check that the backend is running, then refresh.');
      })
      .finally(() => { if (isCurrent()) { setLoading(false); setRefreshing(false); } }),
  [fetchStock]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  const refresh = () => { setRefreshing(true); load(); };

  useEffect(() => {
    fetch(`${API_URL}/api/yards`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setYards(Array.isArray(list) ? list.map((y: { id: string; name: string }) => ({ id: y.id, name: y.name })) : []))
      .catch(() => setYards([]));
  }, [API_URL]);

  // Search matches the model-type or any serial inside it. A serial match opens the group.
  const term = search.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!data) return [];
    if (!term) return data.groups;
    return data.groups.filter((g) =>
      g.modelType.toLowerCase().includes(term) ||
      g.machines.some((m) => m.serialNumber.toLowerCase().includes(term) || m.model?.toLowerCase().includes(term))
    );
  }, [data, term]);

  // Machines behind the clicked card, across all model-types. Free stock keeps FIFO
  // order per model-type; the other lists show the oldest first.
  const cardMachines = useMemo(() => {
    if (!data || !cardList) return [];
    const { match } = CARD_LISTS[cardList];
    const list = data.groups.flatMap((g) => g.machines.filter(match));
    return cardList === 'FREE'
      ? list.sort((a, b) => a.modelType.localeCompare(b.modelType) || (a.fifoRank ?? 0) - (b.fifoRank ?? 0))
      : list.sort((a, b) => (b.daysInYard ?? -1) - (a.daysInYard ?? -1));
  }, [data, cardList]);

  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openEdit = (m: StockMachine) => {
    setEditing(m);
    setEditDate(m.inwardSource === 'ACTUAL' ? toDateInput(m.inwardAt) : '');
    setEditError(null);
  };

  const saveDate = async (value: string | null) => {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`${API_URL}/api/yard-stock/${editing.id}/inward-date`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ date: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setEditError(body?.error || `Save failed (${res.status})`); return; }
      setEditing(null);
      setRefreshing(true);
      await load();
    } catch {
      setEditError('Connection error - try again');
    } finally {
      setSaving(false);
    }
  };

  const openClear = (m: StockMachine) => {
    setClearing(m);
    setClearRemark('');
    setClearError(null);
  };

  const saveClear = async () => {
    if (!clearing) return;
    setClearSaving(true);
    setClearError(null);
    try {
      const res = await fetch(`${API_URL}/api/yard-stock/${clearing.id}/clear-hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ remark: clearRemark }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setClearError(body?.error || `Clear failed (${res.status})`); return; }
      setClearing(null);
      setRefreshing(true);
      await load();
    } catch {
      setClearError('Connection error - try again');
    } finally {
      setClearSaving(false);
    }
  };

  if (loading) return <PageSpinner />;

  const totals = data?.totals;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Yard Stock"
        description="Machines in the yard by model-type, oldest first (FIFO)"
        actions={
          <Button variant="ghost" onClick={refresh} icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>
      )}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard label="Free stock" value={totals.available} icon={<Boxes />} color="green" hint={`${totals.modelTypes} model-types`} onClick={() => setCardList('FREE')} />
          <StatCard label="Planned for dispatch" value={totals.reserved} icon={<ClipboardList />} color="purple" hint="Waiting to go out" onClick={() => setCardList('PLANNED')} />
          <StatCard label="Awaiting verification" value={totals.pendingVerify} icon={<ShieldAlert />} color="amber" hint="In a slot, not yet checked" onClick={() => setCardList('UNVERIFIED')} />
          <StatCard
            label="Estimated dates"
            value={totals.estimated + totals.undated}
            icon={<Clock />}
            color={totals.estimated + totals.undated > 0 ? 'red' : 'slate'}
            hint="Stage 18 or unknown date"
            onClick={() => setCardList('ESTIMATED')}
          />
        </div>
      )}

      {totals && totals.returnHold > 0 && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          {totals.returnHold} machine{totals.returnHold === 1 ? '' : 's'} came back after dispatch and {totals.returnHold === 1 ? 'is' : 'are'} on hold, so not counted as free stock.
          {canEditDate ? ' Check the machine, then open it and use Clear for Dispatch.' : ' A yard manager must check and clear it before it can be planned.'}
          {' '}<button type="button" onClick={() => setCardList('RETURN_HOLD')} className="font-semibold underline hover:text-red-900">View list</button>
        </p>
      )}

      {totals && totals.estimated + totals.undated > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {totals.estimated + totals.undated} machine{totals.estimated + totals.undated === 1 ? '' : 's'} have no gate check-in, so their place in the FIFO order is
          estimated from the stage 18 date{totals.undated > 0 ? ' or unknown' : ''}.
          {canEditDate ? ' Enter the real inward date with the pencil icon to correct the order.' : ' A yard manager can enter the real inward date.'}
        </p>
      )}

      <SectionCard
        title={`Stock by model-type (${groups.length})`}
        noPadding
        action={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Select
              value={yardId}
              onChange={(e) => setYardId(e.target.value)}
              options={[{ value: '', label: 'All yards' }, ...yards.map((y) => ({ value: y.id, label: y.name }))]}
              className="w-full sm:w-40"
              aria-label="Filter by yard"
            />
            <div className="w-full sm:w-60">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Model-type or serial…"
                icon={<Search className="w-3.5 h-3.5" />}
                aria-label="Search model-type or serial number"
              />
            </div>
          </div>
        }
      >
        {groups.length === 0 ? (
          <EmptyState
            icon={<Boxes className="w-6 h-6 text-slate-400" />}
            title={term ? 'Nothing matches your search' : 'No stock in the yard'}
            description={term ? 'Try another model-type or serial number' : 'Machines appear here once they are parked in a yard slot'}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {groups.map((g) => {
              const expanded = open.has(g.modelType) || (!!term && g.machines.some((m) => m.serialNumber.toLowerCase().includes(term)));
              return (
                <div key={g.modelType}>
                  <button
                    type="button"
                    onClick={() => toggle(g.modelType)}
                    aria-expanded={expanded}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex min-w-0 flex-1 items-start gap-2">
                      {expanded ? <ChevronDown className="mt-0.5 w-4 h-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-0.5 w-4 h-4 shrink-0 text-slate-400" />}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">{g.modelType}</span>
                        {(() => {
                          const next = g.machines.find((m) => m.fifoRank === 1);
                          return next ? (
                            <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                              <span className="rounded bg-emerald-600 px-1 font-bold text-white">Next out</span>
                              <span className="font-medium text-slate-700">{next.serialNumber}</span>
                              <span>· {location(next)} · {next.daysInYard ?? '—'} days since first inward{next.returnedAt ? ' · returned' : ''}</span>
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[11px] text-slate-400">No free machine</span>
                          );
                        })()}
                      </span>
                    </span>
                    <span className="flex w-full flex-col gap-1 sm:w-64">
                      <span className="flex items-center justify-between text-xs tabular-nums">
                        <span><span className="text-base font-bold text-emerald-700">{g.available}</span> <span className="text-slate-500">free of {g.total}</span></span>
                        <span className="flex gap-2">
                          {g.reserved > 0 && <span className="text-violet-700">{g.reserved} planned</span>}
                          {g.onHold > 0 && <span className="text-orange-700">{g.onHold} exit req.</span>}
                          {g.pendingVerify > 0 && <span className="text-amber-700">{g.pendingVerify} not verified</span>}
                          {g.returnHold > 0 && <span className="text-red-700">{g.returnHold} on hold</span>}
                        </span>
                      </span>
                      {/* One bar per model-type: free, planned, exit request, not verified. */}
                      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        {[
                          [g.available, 'bg-emerald-500'],
                          [g.reserved, 'bg-violet-400'],
                          [g.onHold, 'bg-orange-400'],
                          [g.pendingVerify, 'bg-amber-300'],
                          [g.returnHold, 'bg-red-400'],
                        ].map(([n, cls]) => (n as number) > 0 && (
                          <span key={cls as string} className={cls as string} style={{ width: `${((n as number) / Math.max(1, g.total)) * 100}%` }} />
                        ))}
                      </span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50/40">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">1</span>
                          dispatch first (oldest free machine)
                        </span>
                        <span>— = not free, so not numbered</span>
                        <span>Click a serial number for details</span>
                      </p>
                      <Table>
                        <TableHeader>
                          <TableHeaderCell align="center">FIFO</TableHeaderCell>
                          <TableHeaderCell>Serial Number</TableHeaderCell>
                          <TableHeaderCell>Model</TableHeaderCell>
                          <TableHeaderCell>Location</TableHeaderCell>
                          <TableHeaderCell>Inward Date</TableHeaderCell>
                          <TableHeaderCell align="right">Age (first inward)</TableHeaderCell>
                          <TableHeaderCell>Status</TableHeaderCell>
                        </TableHeader>
                        <TableBody>
                          {g.machines.map((m) => {
                            const meta = SOURCE_META[m.inwardSource];
                            return (
                              <TableRow key={m.id} className={m.available ? '' : 'opacity-70'}>
                                <TableCell align="center">
                                  {m.fifoRank
                                    ? <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${m.fifoRank === 1 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{m.fifoRank}</span>
                                    : <span className="text-xs text-slate-400">—</span>}
                                </TableCell>
                                <TableCell>
                                  <button type="button" onClick={() => setDetail(m)} className="text-left font-semibold text-blue-700 hover:underline" title="View machine details">
                                    {m.serialNumber}
                                  </button>
                                  {m.returnedAt && (
                                    <span className="ml-1.5" title={`Left the yard and came back in on ${formatDateShort(m.returnedAt)}`}>
                                      <Badge variant="blue">Returned {formatDateShort(m.returnedAt)}</Badge>
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600">{m.model}</TableCell>
                                <TableCell className="text-[13px] font-medium">{location(m)}</TableCell>
                                <TableCell>
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="text-[13px]">{m.inwardAt ? formatDateShort(m.inwardAt) : '—'}</span>
                                    <span title={meta.hint}><Badge variant={meta.variant}>{meta.label}</Badge></span>
                                    {canEditDate && (
                                      <button
                                        type="button"
                                        onClick={() => openEdit(m)}
                                        title="Set the real inward date"
                                        aria-label={`Set inward date for ${m.serialNumber}`}
                                        className="rounded p-0.5 text-slate-400 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell align="right" className="tabular-nums">{m.daysInYard ?? '—'}</TableCell>
                                <TableCell>
                                  {(() => { const st = stockStatus(m); return <span title={st.hint}><Badge variant={st.variant}>{st.label}</Badge></span>; })()}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <p className="text-[11px] text-slate-500">
        FIFO order uses the real inward date when entered, otherwise the first gate check-in, otherwise the stage 18 completion date.
        A machine that leaves the yard and comes back keeps its first inward date and is tagged Returned.
        Only free machines (parked, verified, not planned for dispatch and not on an exit request) are counted and numbered for dispatch.
      </p>

      <Modal
        open={!!cardList}
        onClose={() => setCardList(null)}
        title={cardList ? `${CARD_LISTS[cardList].title} (${cardMachines.length})` : undefined}
        subtitle={cardList ? `${CARD_LISTS[cardList].subtitle}${yardId ? ` · ${yards.find((y) => y.id === yardId)?.name ?? ''}` : ''}` : undefined}
        size="xl"
        footer={<Button variant="secondary" onClick={() => setCardList(null)}>Close</Button>}
      >
        {cardMachines.length === 0 ? (
          <EmptyState icon={<Boxes className="w-6 h-6 text-slate-400" />} title="No machines" description="Nothing in the yard matches this card" />
        ) : (
          <Table>
            <TableHeader>
              {cardList === 'FREE' && <TableHeaderCell align="center">FIFO</TableHeaderCell>}
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Model-type</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Inward Date</TableHeaderCell>
              <TableHeaderCell align="right">Age (days)</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {cardMachines.map((m) => {
                const st = stockStatus(m);
                const meta = SOURCE_META[m.inwardSource];
                return (
                  <TableRow key={m.id}>
                    {cardList === 'FREE' && (
                      <TableCell align="center" className="tabular-nums text-xs">{m.fifoRank ?? '—'}</TableCell>
                    )}
                    <TableCell>
                      <button type="button" onClick={() => setDetail(m)} className="text-left font-semibold text-blue-700 hover:underline" title="View machine details">
                        {m.serialNumber}
                      </button>
                      <span className="block text-[11px] text-slate-400">{m.model}</span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">{m.modelType}</TableCell>
                    <TableCell className="text-[13px] font-medium">{location(m)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[13px]">{m.inwardAt ? formatDateShort(m.inwardAt) : '—'}</span>
                        <span title={meta.hint}><Badge variant={meta.variant}>{meta.label}</Badge></span>
                      </span>
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">{m.daysInYard ?? '—'}</TableCell>
                    <TableCell><span title={st.hint}><Badge variant={st.variant}>{st.label}</Badge></span></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.serialNumber}
        subtitle={detail ? `${detail.modelType} · ${detail.model}` : undefined}
        size="md"
        footer={
          <>
            {detail && canEditDate && detail.returnHoldAt && (
              <Button onClick={() => { const m = detail; setDetail(null); openClear(m); }} icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                Clear for Dispatch
              </Button>
            )}
            {detail && canEditDate && (
              <Button variant="secondary" onClick={() => { const m = detail; setDetail(null); openEdit(m); }} icon={<Pencil className="w-3.5 h-3.5" />}>
                Set Inward Date
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detail && (() => {
          const st = stockStatus(detail);
          const src = SOURCE_META[detail.inwardSource];
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={st.variant}>{st.label}</Badge>
                <span className="text-xs text-slate-600">{st.hint}</span>
              </div>
              <div className="flex items-center gap-4 rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Location</p>
                  <p className="text-sm text-slate-900">
                    {detail.yard?.name ?? '—'}
                    {detail.row !== null && detail.col !== null && <span className="ml-2 text-2xl font-bold">{slotLabel(detail.row, detail.col)}</span>}
                  </p>
                </div>
                {detail.fifoRank && (
                  <div className="text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">FIFO</p>
                    <p className={`text-2xl font-bold ${detail.fifoRank === 1 ? 'text-emerald-700' : 'text-slate-700'}`}>{detail.fifoRank}</p>
                  </div>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                {[
                  ['Model-type', detail.modelType],
                  ['Model', detail.model],
                  ['FERT category', detail.fertCategory ?? '—'],
                  ['Age (first inward)', detail.daysInYard !== null ? `${detail.daysInYard} days` : '—'],
                  ['First inward date', detail.inwardAt ? formatDateShort(detail.inwardAt) : '—'],
                  ['Date taken from', src.hint],
                  ...(detail.returnedAt ? [['Returned to yard', formatDateShort(detail.returnedAt)]] : []),
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-[11px] text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-900">{v}</dd>
                  </div>
                ))}
              </dl>
              {detail.returnHoldAt && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Came back in on {formatDateShort(detail.returnHoldAt)} after being dispatched. Find out why it was returned and check it
                  before it goes to another customer.
                  {canEditDate ? ' Then use Clear for Dispatch.' : ' A yard manager must clear it.'}
                </p>
              )}
              {(detail.inwardSource === 'STAGE18' || detail.inwardSource === 'UNKNOWN') && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This date is an estimate, so the machine&apos;s FIFO place may be wrong.
                  {canEditDate ? ' Use Set Inward Date to enter the real date.' : ' A yard manager can enter the real date.'}
                </p>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Real inward date"
        subtitle={editing ? `${editing.serialNumber} · ${editing.modelType}` : undefined}
        size="sm"
        footer={
          <>
            {editing?.inwardSource === 'ACTUAL' && (
              <Button variant="ghost" onClick={() => saveDate(null)} loading={saving}>Clear</Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => saveDate(editDate)} disabled={!editDate} loading={saving}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            For a machine that was in the yard before the system went live. This date decides its place in the FIFO order,
            ahead of the gate and stage 18 dates.
          </p>
          {editing && editing.inwardSource !== 'ACTUAL' && (
            <p className="text-[11px] text-slate-500">
              Currently using: {SOURCE_META[editing.inwardSource].hint.toLowerCase()}
              {editing.inwardAt ? ` (${formatDateShort(editing.inwardAt)})` : ''}.
            </p>
          )}
          <Input
            label="Date the machine entered the yard"
            type="date"
            value={editDate}
            max={toDateInput(new Date().toISOString())}
            onChange={(e) => setEditDate(e.target.value)}
          />
          {editError && <p className="text-xs font-medium text-red-700">{editError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!clearing}
        onClose={() => setClearing(null)}
        title="Clear for Dispatch"
        subtitle={clearing ? `${clearing.serialNumber} · ${clearing.modelType}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearing(null)}>Cancel</Button>
            <Button onClick={saveClear} disabled={clearRemark.trim().length < 3} loading={clearSaving}>Clear Hold</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            This machine came back after dispatch. Clearing it makes it free stock again, and it keeps its first inward date,
            so it will be first in line for the next plan of its model-type.
          </p>
          <Input
            label="Remark (required)"
            value={clearRemark}
            maxLength={500}
            onChange={(e) => setClearRemark(e.target.value)}
            placeholder="Why it came back and what was checked"
          />
          <p className="text-[11px] text-slate-500">Your name, the time and this remark are recorded.</p>
          {clearError && <p className="text-xs font-medium text-red-700">{clearError}</p>}
        </div>
      </Modal>
    </div>
  );
}

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
import { ParkStatusBadge } from '@/components/ui/StatusBadge';
import { slotLabel, formatDateShort } from '@/lib/format';
import { Boxes, ChevronDown, ChevronRight, ClipboardList, Clock, Pencil, RefreshCw, Search, ShieldAlert } from 'lucide-react';

type InwardSource = 'ACTUAL' | 'GATE' | 'STAGE18' | 'UNKNOWN';

interface StockMachine {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string;
  fertCategory: string | null;
  parkStatus: string;
  verified: boolean;
  reservedFor: { planId: string; planNo: string; salesOrderNo: string } | null;
  exitPending: boolean;
  available: boolean;
  yard: { id: string; name: string } | null;
  row: number | null;
  col: number | null;
  inwardAt: string | null;
  inwardSource: InwardSource;
  daysInYard: number | null;
  fifoRank: number | null;
}

interface StockGroup {
  modelType: string;
  available: number;
  reserved: number;
  onHold: number;
  pendingVerify: number;
  total: number;
  oldestInwardAt: string | null;
  oldestDays: number | null;
  machines: StockMachine[];
}

interface StockResponse {
  generatedAt: string;
  totals: { available: number; reserved: number; onHold: number; pendingVerify: number; total: number; modelTypes: number; undated: number; estimated: number };
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

  const [editing, setEditing] = useState<StockMachine | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  if (loading) return <PageSpinner />;

  const totals = data?.totals;

  return (
    <div className="space-y-4">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Free stock" value={totals.available} icon={<Boxes className="w-4 h-4" />} color="green" hint={`Verified, not reserved · ${totals.modelTypes} model-types`} />
          <StatCard label="Reserved" value={totals.reserved} icon={<ClipboardList className="w-4 h-4" />} color="purple" hint="Held for dispatch plans" />
          <StatCard label="Awaiting verification" value={totals.pendingVerify} icon={<ShieldAlert className="w-4 h-4" />} color="amber" hint="In a slot, not yet checked" />
          <StatCard
            label="Estimated dates"
            value={totals.estimated + totals.undated}
            icon={<Clock className="w-4 h-4" />}
            color={totals.estimated + totals.undated > 0 ? 'red' : 'slate'}
            hint="Stage 18 or unknown date"
          />
        </div>
      )}

      {totals && totals.estimated + totals.undated > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {totals.estimated + totals.undated} machine{totals.estimated + totals.undated === 1 ? '' : 's'} have no gate check-in, so their place in the FIFO order is
          estimated from the stage 18 date{totals.undated > 0 ? ' or unknown' : ''}.
          {canEditDate ? ' Enter the real inward date with the pencil icon to correct the order.' : ' A yard manager can enter the real inward date.'}
        </p>
      )}

      <SectionCard
        title={`Stock by model-type (${groups.length})`}
        description="Click a model-type to see its machines in dispatch order"
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
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {expanded ? <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" /> : <ChevronRight className="w-4 h-4 shrink-0 text-slate-400" />}
                      <span className="truncate text-[13px] font-semibold text-slate-900">{g.modelType}</span>
                    </span>
                    <span className="flex items-center gap-4 text-xs tabular-nums">
                      <span><span className="text-base font-bold text-emerald-700">{g.available}</span> <span className="text-slate-500">free</span></span>
                      {g.reserved > 0 && <span className="text-violet-700">{g.reserved} reserved</span>}
                      {g.onHold > 0 && <span className="text-orange-700">{g.onHold} on exit request</span>}
                      {g.pendingVerify > 0 && <span className="text-amber-700">+{g.pendingVerify} awaiting verify</span>}
                      <span className="text-slate-500">
                        Oldest: {g.oldestInwardAt ? `${formatDateShort(g.oldestInwardAt)} (${g.oldestDays} d)` : '—'}
                      </span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50/40">
                      <Table>
                        <TableHeader>
                          <TableHeaderCell align="center">FIFO</TableHeaderCell>
                          <TableHeaderCell>Serial Number</TableHeaderCell>
                          <TableHeaderCell>Model</TableHeaderCell>
                          <TableHeaderCell>Location</TableHeaderCell>
                          <TableHeaderCell>Inward Date</TableHeaderCell>
                          <TableHeaderCell align="right">Days</TableHeaderCell>
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
                                <TableCell><span className="font-medium text-slate-900">{m.serialNumber}</span></TableCell>
                                <TableCell className="text-xs text-slate-600">{m.model}</TableCell>
                                <TableCell className="text-[13px]">
                                  {m.yard ? `${m.yard.name} · ${m.row !== null && m.col !== null ? slotLabel(m.row, m.col) : ''}` : '—'}
                                </TableCell>
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
                                  {m.reservedFor
                                    ? <span title={`Sales order ${m.reservedFor.salesOrderNo}`}><Badge variant="purple">Reserved · {m.reservedFor.planNo}</Badge></span>
                                    : m.exitPending
                                      ? <Badge variant="orange">Exit request</Badge>
                                      : <ParkStatusBadge status={m.parkStatus} />}
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
        Only free machines (parked, verified, not reserved and not on an exit request) are counted and numbered for dispatch.
      </p>

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
    </div>
  );
}

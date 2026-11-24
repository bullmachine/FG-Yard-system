'use client';

/**
 * Machine Tracking: one page for every machine, from the first assembly stage to the
 * yard and out. It replaces the separate Assembly Line page: the stage buttons, the
 * Completed list with its date range, the plant sync and the stage counts sit next to
 * the yard tools (Add Machine, initial stock load) and the movement history.
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { SectionCard } from '@/components/ui/Card';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { AssemblyStageBadge, MachineStatusBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import Badge from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import MachineHistoryModal, { HistoryTab, Movement } from '@/components/MachineHistoryModal';
import StockUploadModal from '@/components/StockUploadModal';
import PlantUpdateButton from '@/components/PlantUpdateButton';
import { plantStateMeta } from '@/lib/plantState';
import { formatDateShort, formatDateTime, slotLabel } from '@/lib/format';
import {
  Search, Plus, MapPin, Clock, FileSpreadsheet, RefreshCw,
  AlertCircle, CheckCircle2, X
} from 'lucide-react';

interface SlotRef { row: number; col: number; yard?: { name: string } }

interface Machine {
  id: string; serialNumber: string; model: string; productionDate?: string;
  status: 'AVAILABLE' | 'SOLD' | 'RESERVED' | 'UNDER_INSPECTION' | 'IN_REPAIR' | 'DISPATCHED';
  assemblyStage: number; parkStatus: string;
  barcode?: string | null;
  orderNo?: string | null;
  modelType?: string | null;
  lastSyncAt?: string | null;
  isDemo?: boolean;
  assemblyCompleted?: boolean;
  assemblyCompletedAt?: string | null;
  reworkOpenStages?: number[];
  plantStatus?: { stage: number; state: string | null } | null;
  plannedSlotId?: string | null;
  currentSlot?: (SlotRef & { id: string }) | null;
  plannedSlot?: SlotRef | null;
  // The list already carries the movements, so the history modal reads them from here.
  movements?: Movement[];
}

interface Yard {
  id: string; name: string;
  slots: Array<{ id: string; row: number; col: number; status: string }>;
}

interface AvailabilitySummary {
  availability: Array<{ yardId: string; yardName: string; total: number; available: number; reserved: number; occupied: number; other: number }>;
  totalAvailable: number;
  waiting: Array<{ id: string; serialNumber: string; model: string; assemblyStage: number; parkStatus: string; slotWaitingSince: string | null }>;
}

interface StuckRefresh { checked: number; refreshed: number; advanced: number; notFound: string[]; }
interface SyncResult { totalOrders: number; created: number; updated: number; errors: string[]; window?: { from: string; to: string; days: number }; emptyDays?: string[]; stuckRefresh?: StuckRefresh; }
interface SyncStatus { lastSyncAt: string | null; totalMachines: number; machinesByStage: Record<number, number>; windowDays?: number; scheduler?: { isSyncing: boolean; lastSyncResult: SyncResult | null; cronExpression: string; }; }
interface StageStat { total: number; inProgress: number; startedToday: number; }
// Machine counts for the tiles; the operation counts (one machine passes several stages
// a day) are quoted as hints.
interface StageStats { byStage: Record<string, StageStat>; startedTodayTotal: number; machinesStartedToday: number; inProgressTotal: number; machinesInProgress: number; }
interface Notice { type: 'success' | 'error'; message: string; }

const STATUS_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'UNDER_INSPECTION', label: 'Under Inspection' },
  { value: 'IN_REPAIR', label: 'In Repair' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'DISPATCHED', label: 'Dispatched' },
];

// Where a machine that has finished stage 18 is now. Parking states are grouped
// because the yard cares that it is in a slot, not which security step it is at.
type CompletedFilter = 'ALL' | 'AWAITING_BARCODE' | 'READY_TO_MOVE' | 'IN_TRANSIT' | 'AT_GATE' | 'PARKED' | 'EXITED';
const COMPLETED_FILTERS: { value: CompletedFilter; label: string; match: (parkStatus: string) => boolean; tone: string }[] = [
  { value: 'ALL', label: 'All', match: () => true, tone: 'bg-slate-200 text-slate-800' },
  { value: 'AWAITING_BARCODE', label: 'No Barcode', match: (s) => s === 'PLANNED', tone: 'bg-red-100 text-red-800' },
  { value: 'READY_TO_MOVE', label: 'Ready to Move', match: (s) => s === 'READY_TO_MOVE', tone: 'bg-emerald-100 text-emerald-800' },
  { value: 'IN_TRANSIT', label: 'In Transit', match: (s) => s === 'IN_TRANSIT', tone: 'bg-blue-100 text-blue-800' },
  { value: 'AT_GATE', label: 'At Gate', match: (s) => s === 'AT_GATE', tone: 'bg-indigo-100 text-indigo-800' },
  { value: 'PARKED', label: 'Parked', match: (s) => s.startsWith('PARKED_'), tone: 'bg-amber-100 text-amber-800' },
  { value: 'EXITED', label: 'Exited', match: (s) => s === 'EXITED', tone: 'bg-slate-200 text-slate-700' },
];

// The plant's state for the machine's latest operation, e.g. "S18 In inspection".
function PlantStatusTag({ status }: { status?: Machine['plantStatus'] }) {
  const meta = plantStateMeta(status?.state);
  if (!status || !meta) return null;
  return (
    <span className="mt-1 block">
      <Badge variant={meta.variant}>S{status.stage} {meta.label}</Badge>
    </span>
  );
}

// Local calendar day (YYYY-MM-DD) of a time, to compare with the date boxes.
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function MachineTracking() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);

  // View: null = every machine, a number = machines still in assembly at that stage,
  // 'completed' = machines that have finished stage 18.
  const [selectedStage, setSelectedStage] = useState<number | 'completed' | null>(null);
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>('ALL');
  const [doneFrom, setDoneFrom] = useState('');
  const [doneTo, setDoneTo] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [parkFilter, setParkFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Plant sync and stage counts.
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [stageStats, setStageStats] = useState<StageStats | null>(null);
  // Demo machines (seeded sample data) are hidden unless asked for. The toggle is only
  // offered when demo rows exist, tracked separately so hiding them keeps the toggle.
  const [includeDemo, setIncludeDemo] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);

  // Yard tools.
  const [yards, setYards] = useState<Yard[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySummary | null>(null);
  const [initialStockLoad, setInitialStockLoad] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [selectedYard, setSelectedYard] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [allocateRemark, setAllocateRemark] = useState('');
  const [allocateError, setAllocateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newMachine, setNewMachine] = useState({ serialNumber: '', model: '', productionDate: '', status: 'AVAILABLE' as Machine['status'] });

  // History is opened by id, so it never shares selection state with Allocate.
  const [historyMachineId, setHistoryMachineId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('stages');

  const { isAuthenticated, can } = useAuth();
  const canManageMachines = isAuthenticated && can('machines.add');
  // A machine not yet in a slot enters the yard only through Gate Control. Placing one
  // by hand is for the stock parked before go-live, while an Admin has Initial stock load on.
  const canStockLoad = initialStockLoad && can('machines.allocate');
  const canSync = isAuthenticated && can('assembly.sync');
  const canRefresh = isAuthenticated && can('assembly.refresh');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchMachines = async () => {
    try {
      const r = await fetch(`${API_URL}/api/machines?includeDemo=${includeDemo}&withAssemblyCompletion=true`, { headers: headers() });
      const d = await r.json();
      setMachines(Array.isArray(d) ? d : []);
    } catch { } finally { setLoading(false); }
  };
  const fetchSyncStatus = async () => {
    try { const r = await fetch(`${API_URL}/api/assembly/sync/status`, { headers: headers() }); if (r.ok) setSyncStatus(await r.json()); } catch { }
  };
  const fetchStageStats = async () => {
    try { const r = await fetch(`${API_URL}/api/assembly/stage-stats?includeDemo=${includeDemo}`, { headers: headers() }); if (r.ok) setStageStats(await r.json()); } catch { }
  };
  const fetchYards = async () => {
    try {
      const res = await fetch(`${API_URL}/api/yards`, { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      const withSlots = await Promise.all(data.map(async (y: Yard) => {
        const r = await fetch(`${API_URL}/api/yards/${y.id}`, { headers: headers() });
        const d = await r.json();
        return { ...y, slots: d.slots || [] };
      }));
      setYards(withSlots);
    } catch { }
  };
  const fetchAvailability = async () => {
    try { const r = await fetch(`${API_URL}/api/yards/availability`, { headers: headers() }); if (r.ok) setAvailability((await r.json()) ?? null); } catch { }
  };
  const fetchStockLoad = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/stock-load`, { headers: headers() });
      if (res.ok) setInitialStockLoad(!!(await res.json()).initialStockLoad);
    } catch { }
  };

  // Once: sync status and the yard tools.
  useEffect(() => {
    const load = async () => { await Promise.all([fetchSyncStatus(), fetchYards(), fetchAvailability(), fetchStockLoad()]); };
    load();
  }, []);

  // Machines and stage counts, again whenever the demo visibility changes. State is
  // only set from the async callbacks, never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [machinesRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/api/machines?includeDemo=${includeDemo}&withAssemblyCompletion=true`, { headers: headers() }),
          fetch(`${API_URL}/api/assembly/stage-stats?includeDemo=${includeDemo}`, { headers: headers() })
        ]);
        if (cancelled) return;
        if (machinesRes.ok) {
          const list: Machine[] = await machinesRes.json();
          if (!cancelled) {
            setMachines(Array.isArray(list) ? list : []);
            if (includeDemo) setDemoAvailable(list.some((m) => m.isDemo));
          }
        }
        if (!includeDemo) {
          // The filtered list cannot tell whether demo rows exist, so ask once.
          const probe = await fetch(`${API_URL}/api/machines?includeDemo=true`, { headers: headers() });
          if (probe.ok && !cancelled) {
            const all: Machine[] = await probe.json();
            setDemoAvailable(all.some((m) => m.isDemo));
          }
        }
        if (statsRes.ok) {
          const stats = await statsRes.json();
          if (!cancelled) setStageStats(stats);
        }
      } catch {
        // Leave the previous data in place if the refresh fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [includeDemo, API_URL]);

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/assembly/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: '{}' });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setNotice({ type: 'error', message: `Sync failed (${res.status}): ${body?.error || res.statusText}` }); return; }
      if (body?.error) { setNotice({ type: 'error', message: `Sync failed: ${body.error}` }); return; }

      const result: SyncResult = body?.result || body;
      if (result?.errors?.length) {
        setNotice({ type: 'error', message: `Sync completed with ${result.errors.length} error(s): ${result.errors[0]}` });
      } else {
        const parts: string[] = [];
        // The exact range queried: a short result otherwise cannot be told from a wrong window.
        if (result.window) parts.push(`${result.window.from} to ${result.window.to} (${result.window.days}d)`);
        parts.push(`${result.created || 0} created, ${result.updated || 0} updated from ${result.totalOrders || 0} order(s)`);
        if (result.emptyDays?.length) parts.push(`${result.emptyDays.length} day(s) with no orders`);
        // Orders below stage 18 that have left the window are refreshed by order number.
        const stuck = result.stuckRefresh;
        if (stuck && stuck.checked > 0) {
          parts.push(`${stuck.refreshed}/${stuck.checked} pre-stage-18 order(s) refreshed`);
          if (stuck.notFound.length) parts.push(`${stuck.notFound.length} not returned by the plant`);
        }
        setNotice({ type: 'success', message: `Sync complete: ${parts.join(' - ')}` });
      }
      await fetchMachines();
      await fetchSyncStatus();
      await fetchStageStats();
    } catch (e) {
      setNotice({ type: 'error', message: `Sync request failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setSyncing(false);
    }
  };

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/machines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(newMachine),
      });
      if (res.ok) { await fetchMachines(); setShowAddModal(false); setNewMachine({ serialNumber: '', model: '', productionDate: '', status: 'AVAILABLE' }); }
      else { const body = await res.json().catch(() => null); setNotice({ type: 'error', message: body?.error || `Add machine failed (${res.status})` }); }
    } finally { setSubmitting(false); }
  };

  const closeAllocate = () => { setShowAllocateModal(false); setSelectedMachine(null); setSelectedYard(''); setSelectedSlot(''); setAllocateRemark(''); setAllocateError(null); };

  const handleAllocate = async () => {
    if (!selectedMachine || !selectedSlot) return;
    setSubmitting(true);
    setAllocateError(null);
    try {
      const res = await fetch(`${API_URL}/api/machines/${selectedMachine.id}/allocate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ slotId: selectedSlot, reason: 'RELOCATION', notes: allocateRemark }),
      });
      if (res.ok) { await fetchMachines(); closeAllocate(); }
      else { const body = await res.json().catch(() => null); setAllocateError(body?.error || `Allocate failed (${res.status})`); }
    } catch {
      setAllocateError('Connection error - try again');
    } finally { setSubmitting(false); }
  };

  const openHistory = (machine: Machine, tab: HistoryTab) => {
    setHistoryTab(tab);
    setHistoryMachineId(machine.id);
  };
  const historyMachine = historyMachineId ? machines.find(m => m.id === historyMachineId) ?? null : null;

  // Every filter change starts again on page 1.
  const withPageReset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const chooseStage = withPageReset(setSelectedStage);
  const chooseCompletedFilter = withPageReset(setCompletedFilter);
  const applySearch = withPageReset(setSearch);
  const applyStatusFilter = withPageReset(setStatusFilter);
  const applyParkFilter = withPageReset(setParkFilter);
  const applyDoneFrom = withPageReset(setDoneFrom);
  const applyDoneTo = withPageReset(setDoneTo);

  // Search, Status and Park status apply in every view.
  const term = search.trim().toLowerCase();
  const searched = useMemo(() => machines.filter(m => {
    const matchesSearch = !term ||
      m.serialNumber?.toLowerCase().includes(term) ||
      m.orderNo?.toLowerCase().includes(term) ||
      m.barcode?.toLowerCase().includes(term) ||
      m.model?.toLowerCase().includes(term);
    return matchesSearch && (!statusFilter || m.status === statusFilter) && (!parkFilter || m.parkStatus === parkFilter);
  }), [machines, term, statusFilter, parkFilter]);

  // Still in assembly: has a stage and stage 18 is not finished. Finished machines are
  // only under Completed, so stage 18 shows just the ones still being worked on.
  const inAssembly = machines.filter(m => m.assemblyStage > 0 && !m.assemblyCompleted);
  const completed = machines.filter(m => m.assemblyCompleted);
  const showingCompleted = selectedStage === 'completed';
  const completedMatch = COMPLETED_FILTERS.find(f => f.value === completedFilter)!.match;
  // The date range applies in every view. Completed matches on the day stage 18 was
  // completed; All and a stage match on the day assembly started (productionDate, the
  // plant's first operation start).
  const inRange = (iso?: string | null) => {
    if (!doneFrom && !doneTo) return true;
    if (!iso) return false;
    const day = localDay(iso);
    return (!doneFrom || day >= doneFrom) && (!doneTo || day <= doneTo);
  };
  const inDoneRange = (m: Machine) => inRange(m.assemblyCompletedAt);
  const inStartRange = (m: Machine) => inRange(m.productionDate);
  const dateLabel = showingCompleted ? 'Completed' : 'Started';

  const filtered = showingCompleted
    ? searched
        .filter(m => m.assemblyCompleted && completedMatch(m.parkStatus) && inDoneRange(m))
        .sort((a, b) => (b.assemblyCompletedAt ?? '').localeCompare(a.assemblyCompletedAt ?? ''))
    : selectedStage === null
      ? searched.filter(inStartRange)
      : searched.filter(m => !m.assemblyCompleted && m.assemblyStage === selectedStage && inStartRange(m));

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const parkStatusOptions = Array.from(new Set(machines.map(m => m.parkStatus).filter(Boolean))).sort().map(v => ({ value: v, label: v }));
  const demoCount = machines.filter(m => m.isDemo).length;
  const anyFilter = !!(term || statusFilter || parkFilter || doneFrom || doneTo);
  const rangeText = doneFrom || doneTo ? ` · ${dateLabel.toLowerCase()} ${doneFrom ? formatDateShort(doneFrom) : '…'} to ${doneTo ? formatDateShort(doneTo) : '…'}` : '';

  const locationCell = (m: Machine) => {
    if (m.currentSlot) {
      return (
        <span className="inline-flex items-center gap-1 text-[13px]">
          <MapPin className="w-3.5 h-3.5 text-slate-400" />
          {m.currentSlot.yard?.name ? `${m.currentSlot.yard.name} ` : ''}({slotLabel(m.currentSlot.row, m.currentSlot.col)})
        </span>
      );
    }
    if (m.plannedSlot || m.plannedSlotId) {
      return (
        <span className="text-xs text-yellow-700 font-medium">
          Reserved{m.plannedSlot ? ` ${m.plannedSlot.yard?.name ? `${m.plannedSlot.yard.name} ` : ''}(${slotLabel(m.plannedSlot.row, m.plannedSlot.col)})` : ''}
        </span>
      );
    }
    const awaiting = m.assemblyCompleted && ['READY_TO_MOVE', 'IN_TRANSIT', 'AT_GATE'].includes(m.parkStatus);
    if (!awaiting && !canStockLoad) return <span className="text-xs text-slate-400">—</span>;
    return (
      <div className="flex items-center gap-2">
        {awaiting && (
          <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5" title="Ready to move but no slot is assigned at gate yet">Awaiting gate slot</span>
        )}
        {canStockLoad && (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedMachine(m); setShowAllocateModal(true); }}>Allocate</Button>
        )}
      </div>
    );
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Machine Tracking"
        description={`${machines.length} machines · assembly stages 1–18, yard and dispatch`}
        actions={canSync || canManageMachines || canStockLoad ? (
          <div className="flex flex-wrap gap-2">
            {canSync && (
              <div className="flex flex-col items-end">
                <Button variant="secondary" icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />} onClick={handleSync} loading={syncing}>
                  Sync last {syncStatus?.windowDays ?? 7} days
                </Button>
                <span
                  className="mt-0.5 text-[10px] text-slate-500"
                  title={syncStatus?.scheduler?.cronExpression ? `Automatic sync schedule: ${syncStatus.scheduler.cronExpression}` : undefined}
                >
                  Last synced {syncStatus?.lastSyncAt ? formatDateTime(syncStatus.lastSyncAt) : 'never'}
                </span>
              </div>
            )}
            {canStockLoad && <Button variant="secondary" icon={<FileSpreadsheet className="w-4 h-4" />} onClick={() => setShowUpload(true)}>Upload Stock List</Button>}
            {canManageMachines && <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>Add Machine</Button>}
          </div>
        ) : undefined}
      />

      {notice && (
        <div role="status" className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {notice.type === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1 text-xs leading-relaxed">{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}
      <StockUploadModal open={showUpload} onClose={() => setShowUpload(false)} onDone={() => { void fetchMachines(); }} />

      {initialStockLoad && (
        <p
          className="truncate rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-800"
          title={`${canStockLoad
            ? 'Place machines already parked in the yard with Allocate, or many at once with Upload Stock List (Excel). Each needs Stage 18 and a barcode, and still goes to Security.'
            : 'An Admin or Yard Manager is entering the machines already parked in the yard.'} Switch it off in Settings when the yard stock is entered.`}
        >
          <span className="font-semibold">Initial stock load is ON</span>
          {canStockLoad ? ' · place parked machines with Allocate or Upload Stock List' : ' · yard stock is being entered'} · switch off in Settings when done
        </p>
      )}

      {demoAvailable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] text-purple-800">
            <span className="inline-flex items-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Demo</span>
            <span>
              {includeDemo
                ? `${demoCount} demo machine${demoCount === 1 ? '' : 's'} with sample stage history are included in the list and counts.`
                : 'Demo machines with sample stage history are hidden from the list and counts.'}
            </span>
          </span>
          <button onClick={() => setIncludeDemo((v) => !v)} className="rounded-md border border-purple-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-purple-800 transition-colors hover:bg-purple-100">
            {includeDemo ? 'Hide demo data' : 'Show demo data'}
          </button>
        </div>
      )}

      {/* Machines: view chips (All, a stage, Completed), then filters and the table */}
      <SectionCard
        title={`Machines (${filtered.length})`}
        description={
          showingCompleted
            ? `Completed${completedFilter === 'ALL' ? '' : ` · ${COMPLETED_FILTERS.find(f => f.value === completedFilter)!.label}`}${doneFrom || doneTo ? ` · ${doneFrom ? formatDateShort(doneFrom) : '…'} to ${doneTo ? formatDateShort(doneTo) : '…'}` : ''}`
            : `${selectedStage ? `Still in assembly at stage ${selectedStage}` : 'Every machine: in assembly, completed, in the yard and dispatched'}${rangeText}`
        }
        noPadding
      >
        {/* Filters: one line on laptop and desktop, wrapping on smaller screens */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 lg:flex-nowrap">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <Input value={search} onChange={e => applySearch(e.target.value)} placeholder="Search serial, order no, barcode, model…" icon={<Search className="w-4 h-4" />} aria-label="Search machines by serial number, order number, barcode or model" />
          </div>
          <Select value={statusFilter} onChange={e => applyStatusFilter(e.target.value)} options={[{ value: '', label: 'All Statuses' }, ...STATUS_OPTIONS]} className="w-full shrink-0 sm:w-36" />
          <Select value={parkFilter} onChange={e => applyParkFilter(e.target.value)} options={[{ value: '', label: 'All Park Statuses' }, ...parkStatusOptions]} className="w-full shrink-0 sm:w-40" />
          <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-600" title={showingCompleted ? 'Machines that completed stage 18 between these dates' : 'Machines whose assembly started between these dates'}>
            <span>{dateLabel}</span>
            <input type="date" aria-label={`${dateLabel} from`} value={doneFrom} max={doneTo || undefined} onChange={e => applyDoneFrom(e.target.value)} className="h-9 w-[8.25rem] rounded-lg border border-slate-300 px-2 text-xs" />
            <span>to</span>
            <input type="date" aria-label={`${dateLabel} to`} value={doneTo} min={doneFrom || undefined} onChange={e => applyDoneTo(e.target.value)} className="h-9 w-[8.25rem] rounded-lg border border-slate-300 px-2 text-xs" />
          </div>
          {anyFilter && (
            <button type="button" onClick={() => { applySearch(''); setStatusFilter(''); setParkFilter(''); setDoneFrom(''); setDoneTo(''); }} className="inline-flex h-9 shrink-0 items-center gap-1 px-1 text-[11px] font-medium text-slate-500 hover:text-slate-800">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        <div className="border-b border-slate-100 px-4 py-3">
        {/* Row 1: All and stages 1–18, one line on laptop and desktop */}
        <div className="flex flex-wrap gap-1.5 lg:flex-nowrap lg:gap-1">
          <button onClick={() => chooseStage(null)} className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${selectedStage === null ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            All
            <span className={`text-[10px] px-1 py-0 rounded-full tabular-nums ${selectedStage === null ? 'bg-white/20' : 'bg-slate-200 text-slate-700'}`}>{machines.length}</span>
          </button>
          {Array.from({ length: 18 }, (_, i) => i + 1).map(s => {
            const count = inAssembly.filter(m => m.assemblyStage === s).length;
            const stat = stageStats?.byStage?.[s];
            const busy = !!stat && (stat.startedToday > 0 || stat.inProgress > 0);
            const tip = `Stage ${s}: ${count} machine${count === 1 ? '' : 's'} here`
              + (stat ? ` · ${stat.startedToday} operations started today · ${stat.inProgress} active` : '');
            return (
              <button key={s} title={tip} onClick={() => chooseStage(s)} className={`relative px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 lg:min-w-0 lg:flex-1 lg:justify-center lg:px-1 ${selectedStage === s ? 'bg-indigo-600 text-white shadow-sm' : count > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                {s}
                {count > 0 && <span className={`text-[10px] px-1 py-0 rounded-full tabular-nums ${selectedStage === s ? 'bg-white/20' : 'bg-blue-200 text-blue-800'}`}>{count}</span>}
                {busy && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />}
              </button>
            );
          })}
        </div>

        {/* Row 2: Completed, then today's activity and the last sync window */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            onClick={() => { chooseStage('completed'); setCompletedFilter('ALL'); }}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${showingCompleted ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
            <span className={`text-[10px] px-1 py-0 rounded-full ${showingCompleted ? 'bg-white/20' : 'bg-emerald-200 text-emerald-800'}`}>{completed.length}</span>
          </button>
          {stageStats && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span><span className="font-semibold text-amber-700 tabular-nums">{stageStats.machinesStartedToday}</span> machines started today ({stageStats.startedTodayTotal} ops)</span>
              <span><span className="font-semibold text-emerald-700 tabular-nums">{stageStats.machinesInProgress}</span> in progress ({stageStats.inProgressTotal} ops)</span>
              <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" /> stage with activity today (hover a stage for details)</span>
              {syncStatus?.scheduler?.lastSyncResult?.window && (
                <span title="The first scheduled sync of each day reads the last 30 days.">
                  Last sync read {syncStatus.scheduler.lastSyncResult.window.days} days ({syncStatus.scheduler.lastSyncResult.window.from} to {syncStatus.scheduler.lastSyncResult.window.to})
                </span>
              )}
            </p>
          )}
        </div>

        {showingCompleted && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Completed — where they are now</p>
            <div className="flex flex-wrap gap-1.5">
              {COMPLETED_FILTERS.map(f => {
                const count = completed.filter(m => f.match(m.parkStatus) && inDoneRange(m)).length;
                const active = completedFilter === f.value;
                return (
                  <button key={f.value} onClick={() => chooseCompletedFilter(f.value)} className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : `${f.tone} hover:opacity-80`} ${count === 0 && !active ? 'opacity-50' : ''}`}>
                    {f.label}
                    <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            {anyFilter ? 'No machines match these filters' : showingCompleted ? 'No completed machines in this group' : selectedStage ? 'No machines at this stage' : 'No machines yet'}
          </p>
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableHeaderCell>Serial Number</TableHeaderCell>
                <TableHeaderCell>Model</TableHeaderCell>
                <TableHeaderCell>Order No</TableHeaderCell>
                <TableHeaderCell>Stage</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Park Status</TableHeaderCell>
                {showingCompleted && <TableHeaderCell>Completed On</TableHeaderCell>}
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell>Last Sync</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {paginated.map(m => (
                  <TableRow key={m.id} onClick={() => openHistory(m, 'stages')}>
                    <TableCell>
                      <div>
                        <span className="font-medium text-slate-900">{m.serialNumber}</span>
                        {m.barcode && <span className="block text-[10px] text-slate-400">BC: {m.barcode}</span>}
                        {m.reworkOpenStages && m.reworkOpenStages.length > 0 && (
                          <span title="Quality inspection is RE-WORK at these stages" className="mt-0.5 mr-1 inline-block rounded bg-red-100 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-red-700">
                            Rework S{m.reworkOpenStages.join(', S')}
                          </span>
                        )}
                        {m.isDemo && (
                          <span className="mt-0.5 mr-1 inline-block rounded bg-purple-100 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-purple-700">Demo</span>
                        )}
                        {m.assemblyStage >= 18 && !m.barcode && (
                          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700">No barcode</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span>{m.model || 'N/A'}</span>
                      {m.modelType && <span className="mt-0.5 block"><Badge>{m.modelType}</Badge></span>}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-slate-600">{m.orderNo || '—'}</span>
                      {m.productionDate && <span className="block text-[10px] text-slate-400" title="Assembly started">Started {formatDateShort(m.productionDate)}</span>}
                    </TableCell>
                    <TableCell>
                      {m.assemblyStage > 0 ? (
                        <>
                          <AssemblyStageBadge stage={m.assemblyStage} completed={!!m.assemblyCompleted} />
                          {!m.assemblyCompleted && <PlantStatusTag status={m.plantStatus} />}
                        </>
                      ) : <span className="text-xs text-slate-400" title="No assembly stage recorded yet">—</span>}
                    </TableCell>
                    <TableCell><MachineStatusBadge status={m.status} /></TableCell>
                    <TableCell><ParkStatusBadge status={m.parkStatus} /></TableCell>
                    {showingCompleted && (
                      <TableCell><span className="text-xs text-slate-600">{m.assemblyCompletedAt ? formatDateTime(m.assemblyCompletedAt) : '—'}</span></TableCell>
                    )}
                    <TableCell>{locationCell(m)}</TableCell>
                    <TableCell><span className="text-xs text-slate-400">{m.lastSyncAt ? formatDateTime(m.lastSyncAt) : '—'}</span></TableCell>
                    <TableCell align="right">
                      <div className="inline-flex items-center gap-1.5">
                        {canRefresh && m.orderNo && !m.isDemo && (
                          <PlantUpdateButton
                            orderNo={m.orderNo}
                            onDone={({ ok, message }) => {
                              setNotice({ type: ok ? 'success' : 'error', message });
                              if (ok) { void fetchMachines(); void fetchStageStats(); }
                            }}
                          />
                        )}
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openHistory(m, 'movements'); }} icon={<Clock className="w-3.5 h-3.5" />}>History</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
        <p className="px-4 pb-3 pt-1 text-[11px] text-slate-400">Select a machine row to view its stage history; History shows its yard movements.</p>
      </SectionCard>

      {/* Add Modal */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Machine" footer={<><Button variant="secondary" onClick={() => setShowAddModal(false)}>Cancel</Button><Button onClick={handleAdd} loading={submitting}>Add Machine</Button></>}>
        <div className="space-y-3.5">
          <Input label="Serial Number" value={newMachine.serialNumber} onChange={e => setNewMachine({ ...newMachine, serialNumber: e.target.value })} placeholder="e.g., BH-2024-001" />
          <Input label="Model" value={newMachine.model} onChange={e => setNewMachine({ ...newMachine, model: e.target.value })} placeholder="e.g., Backhoe Loader X200" />
          <Input label="Production Date" type="date" value={newMachine.productionDate} onChange={e => setNewMachine({ ...newMachine, productionDate: e.target.value })} />
          <Select label="Status" value={newMachine.status} onChange={e => setNewMachine({ ...newMachine, status: e.target.value as Machine['status'] })} options={STATUS_OPTIONS} />
        </div>
      </Modal>

      {/* Allocate Modal */}
      <Modal open={showAllocateModal} onClose={closeAllocate} title="Allocate Machine" subtitle="Initial stock load: a machine already parked in the yard" footer={<><Button variant="secondary" onClick={closeAllocate}>Cancel</Button><Button onClick={handleAllocate} loading={submitting} disabled={!selectedSlot || allocateRemark.trim().length < 3}>Allocate</Button></>}>
        {selectedMachine && (
          <div className="space-y-3.5">
            {availability && availability.totalAvailable === 0 && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50">
                <p className="text-xs font-semibold text-red-800">No allocatable slots — all yards are fully reserved</p>
                <p className="text-[11px] text-red-700 mt-0.5">
                  {availability.availability.map(a => `${a.yardName}: ${a.reserved} reserved / ${a.total}`).join(' · ')}.
                  {availability.waiting.some(w => w.id === selectedMachine.id) && ` ${selectedMachine.serialNumber} is one of ${availability.waiting.length} machine(s) waiting for a slot.`}
                </p>
              </div>
            )}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-500">Machine</p>
              <p className="text-[13px] font-semibold text-slate-900">{selectedMachine.serialNumber} — {selectedMachine.model}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Stage {selectedMachine.assemblyStage} · Barcode {selectedMachine.barcode || 'missing'}</p>
            </div>
            {(selectedMachine.assemblyStage < 18 || !selectedMachine.barcode) && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                This machine cannot be placed: it needs Stage 18 cleared and a barcode label. Check it with Quality.
              </p>
            )}
            <Select label="Select Yard" value={selectedYard} onChange={e => { setSelectedYard(e.target.value); setSelectedSlot(''); }} placeholder="Choose a yard" options={yards.map(y => {
              const freeSlots = (y.slots || []).filter(s => s.status === 'AVAILABLE').length;
              return { value: y.id, label: `${y.name} — ${freeSlots} free` };
            })} />
            {selectedYard && (() => {
              const y = yards.find(y => y.id === selectedYard);
              const freeSlots = (y?.slots || []).filter(s => s.status === 'AVAILABLE');
              if (!y || freeSlots.length === 0) {
                return (
                  <div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50">
                    <p className="text-xs font-semibold text-yellow-800">{y ? `${y.name} has no available slots` : 'Choose a yard first'}</p>
                    <p className="text-[11px] text-yellow-700 mt-0.5">All of this yard&apos;s slots are currently reserved. Choose another yard, or release an existing reservation from the FG Yard page.</p>
                  </div>
                );
              }
              return (
                <Select label="Select Slot" value={selectedSlot} onChange={e => setSelectedSlot(e.target.value)} placeholder="Choose a slot" options={freeSlots.map(s => ({ value: s.id, label: `Slot ${slotLabel(s.row, s.col)}` }))} />
              );
            })()}
            <Input label="Remark (required)" value={allocateRemark} maxLength={480} onChange={e => setAllocateRemark(e.target.value)} placeholder="e.g. Parked before go-live, found in slot A-3" />
            <p className="text-[11px] text-slate-500">Choose the slot where the machine physically stands. Your name, the time and the remark are recorded, and Security verifies it next.</p>
            {allocateError && <p className="text-xs font-medium text-red-700">{allocateError}</p>}
          </div>
        )}
      </Modal>

      {/* key remounts on every open/close, so the modal starts on the requested tab
          and never shows the previous machine's cached stage history. */}
      <MachineHistoryModal
        key={historyMachineId ?? 'closed'}
        machineId={historyMachineId}
        serialNumber={historyMachine?.serialNumber}
        initialTab={historyTab}
        movements={historyMachine?.movements ?? []}
        onClose={() => setHistoryMachineId(null)}
      />
    </div>
  );
}

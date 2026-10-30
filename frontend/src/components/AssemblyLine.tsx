'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { SectionCard, StatCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { AssemblyStageBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import { plantStateMeta } from '@/lib/plantState';
import Badge from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import StageHistoryModal from '@/components/StageHistoryModal';
import { formatDateTime, slotLabel } from '@/lib/format';
import { RefreshCw, Factory, Clock, Zap, Activity, Calendar, AlertCircle, CheckCircle2, Search, X, MapPin } from 'lucide-react';

interface SlotRef { row: number; col: number; yard?: { name: string } }
interface Machine { id: string; serialNumber: string; barcode?: string; model: string; machineType?: string; modelType?: string; assemblyStage: number; orderNo?: string; itemCode?: string; itemDescription?: string; parkStatus: string; lastSyncAt?: string; isDemo?: boolean; assemblyCompleted?: boolean; plantStatus?: { stage: number; state: string | null } | null; currentSlot?: SlotRef | null; plannedSlot?: SlotRef | null; }

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

const locationLabel = (m: Machine) => {
  if (m.currentSlot) return `${m.currentSlot.yard?.name ? `${m.currentSlot.yard.name} ` : ''}(${slotLabel(m.currentSlot.row, m.currentSlot.col)})`;
  if (m.plannedSlot) return `Reserved ${m.plannedSlot.yard?.name ? `${m.plannedSlot.yard.name} ` : ''}(${slotLabel(m.plannedSlot.row, m.plannedSlot.col)})`;
  return null;
};
  interface SyncStatus { lastSyncAt: string | null; totalMachines: number; machinesByStage: Record<number, number>; windowDays?: number; scheduler?: { isSyncing: boolean; lastSyncResult: SyncResult | null; cronExpression: string; }; }
  interface StuckRefresh { checked: number; refreshed: number; advanced: number; notFound: string[]; }
  interface SyncResult { totalOrders: number; created: number; updated: number; errors: string[]; window?: { from: string; to: string; days: number }; emptyDays?: string[]; stuckRefresh?: StuckRefresh; }
  interface StageStat { total: number; inProgress: number; startedToday: number; }
  // `machinesStartedToday` / `machinesInProgress` count machines. `startedTodayTotal` /
  // `inProgressTotal` count machine+stage operations, which run to a multiple of the
  // machine counts because one machine passes through several stages a day. The tiles
  // show the machine numbers and quote the operation numbers as a hint.
  interface StageStats { byStage: Record<string, StageStat>; startedTodayTotal: number; machinesStartedToday: number; inProgressTotal: number; machinesInProgress: number; }
interface SyncNotice { type: 'success' | 'error'; message: string; }

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

export default function AssemblyLine() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  // A stage number, 'completed' for machines that have finished stage 18, or null for
  // everything still in assembly.
  const [selectedStage, setSelectedStage] = useState<number | 'completed' | null>(null);
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>('ALL');
  const [search, setSearch] = useState('');
  const [historyMachineId, setHistoryMachineId] = useState<string | null>(null);
  // Demo rows are shown by default so the seeded stage history is visible, but
  // can be hidden to see only real plant machines.
  const [includeDemo, setIncludeDemo] = useState(true);
  const [stageStats, setStageStats] = useState<StageStats | null>(null);
  // Tracked separately from the visible list so the toggle keeps showing up even
  // while demo rows are hidden. Otherwise hiding them would remove the only
  // control that can bring them back.
  const [demoAvailable, setDemoAvailable] = useState(false);
  const { isAuthenticated, can } = useAuth();
  // The sync endpoint is ADMIN-only on the server, so the button follows it.
  const canSync = isAuthenticated && can('assembly.sync');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchMachines = async () => {
    try { const r = await fetch(`${API_URL}/api/machines?includeDemo=${includeDemo}&withAssemblyCompletion=true`, { headers: headers() }); const d = await r.json(); setMachines(d.filter((m: Machine) => m.assemblyStage > 0)); } catch { } finally { setLoading(false); }
  };
  const fetchSyncStatus = async () => { try { const r = await fetch(`${API_URL}/api/assembly/sync/status`, { headers: headers() }); setSyncStatus(await r.json()); } catch { } };
  const fetchStageStats = async () => { try { const r = await fetch(`${API_URL}/api/assembly/stage-stats?includeDemo=${includeDemo}`, { headers: headers() }); if (r.ok) setStageStats(await r.json()); } catch { } };
  useEffect(() => {
    const load = async () => { await fetchMachines(); await fetchSyncStatus(); await fetchStageStats(); };
    load();
  }, []);

  // Re-fetch whenever the demo visibility changes. State is only set from the
  // async callbacks below, never synchronously in this effect body.
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
          const list = await machinesRes.json();
          if (!cancelled) {
            setMachines(list.filter((m: Machine) => m.assemblyStage > 0));
            if (includeDemo) setDemoAvailable(list.some((m: Machine) => m.isDemo));
          }
        } else if (!includeDemo) {
          // The filtered list cannot tell us whether demo rows exist, so ask for
          // them once to decide if the toggle should be offered.
          const probe = await fetch(`${API_URL}/api/machines?includeDemo=true`, { headers: headers() });
          if (probe.ok && !cancelled) {
            const all = await probe.json();
            setDemoAvailable(all.some((m: Machine) => m.isDemo));
          }
        }
        if (statsRes.ok) {
          const stats = await statsRes.json();
          if (!cancelled) setStageStats(stats);
        }
      } catch {
        // Leave the previous data in place if the refresh fails.
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

      if (!res.ok) {
        setNotice({ type: 'error', message: `Sync failed (${res.status}): ${body?.error || res.statusText}` });
        return;
      }

      if (body?.error) {
        setNotice({ type: 'error', message: `Sync failed: ${body.error}` });
        return;
      }

      const result: SyncResult = body?.result || body;
      if (result?.errors?.length) {
        setNotice({ type: 'error', message: `Sync completed with ${result.errors.length} error(s): ${result.errors[0]}` });
      } else {
        const parts: string[] = [];

        // Show the exact range that was queried. Without this the operator cannot tell
        // whether a short result set means "nothing in assembly" or "wrong window".
        if (result.window) {
          parts.push(`${result.window.from} to ${result.window.to} (${result.window.days}d)`);
        }
        parts.push(`${result.created || 0} created, ${result.updated || 0} updated from ${result.totalOrders || 0} order(s)`);
        if (result.emptyDays?.length) {
          parts.push(`${result.emptyDays.length} day(s) with no orders`);
        }

        // Orders below stage 18 that have fallen outside the window can only be
        // refreshed by order number, so report that pass separately.
        const stuck = result.stuckRefresh;
        if (stuck && stuck.checked > 0) {
          parts.push(`${stuck.refreshed}/${stuck.checked} pre-stage-18 order(s) refreshed`);
          if (stuck.notFound.length) {
            parts.push(`${stuck.notFound.length} not returned by the plant`);
          }
        }

        setNotice({ type: 'success', message: `Sync complete: ${parts.join(' - ')}` });
      }

      await fetchMachines();
      await fetchSyncStatus();
    } catch (e) {
      setNotice({ type: 'error', message: `Sync request failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setSyncing(false);
    }
  };

  // Search matches the identifiers an operator would read off a machine tag or
  // scan, and combines with the stage filter. Done here rather than server-side
  // because the assembly list is small and already fully loaded.
  const term = search.trim().toLowerCase();
  const searched = useMemo(() => {
    if (!term) return machines;
    return machines.filter((m) =>
      m.serialNumber?.toLowerCase().includes(term) ||
      m.orderNo?.toLowerCase().includes(term) ||
      m.barcode?.toLowerCase().includes(term) ||
      m.model?.toLowerCase().includes(term)
    );
  }, [machines, term]);

  // Machines that finished stage 18 leave the stage buttons and are only listed
  // under Completed, so stage 18 shows just the ones still being worked on.
  const inAssembly = machines.filter(m => !m.assemblyCompleted);
  const completed = machines.filter(m => m.assemblyCompleted);
  const showingCompleted = selectedStage === 'completed';
  const completedMatch = COMPLETED_FILTERS.find(f => f.value === completedFilter)!.match;

  const filtered = showingCompleted
    ? searched.filter(m => m.assemblyCompleted && completedMatch(m.parkStatus))
    : searched.filter(m => !m.assemblyCompleted && (selectedStage === null || m.assemblyStage === selectedStage));
  // Only meaningful while demo rows are visible; the banner text falls back to
  // the availability flag when they are hidden.
  const demoCount = machines.filter(m => m.isDemo).length;

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Assembly Line"
        description="Track machines through stages 1–18"
        actions={canSync ? (
        <Button variant="secondary" icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />} onClick={handleSync} loading={syncing}>
          Sync last {syncStatus?.windowDays ?? 7} days
        </Button>
        ) : undefined}
      />

      {notice && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
            notice.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="text-xs leading-relaxed">{notice.message}</span>
        </div>
      )}

      {/* Counts come from the stage-stats endpoint, so they render for every
          authenticated user. The sync cards stay behind syncStatus, which is
          admin-only. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <StatCard label="In Assembly" value={inAssembly.length} icon={<Factory className="w-4 h-4" />} color="indigo" hint={`${completed.length} completed`} />
        <StatCard
          label="Started Today"
          value={stageStats ? stageStats.machinesStartedToday : '—'}
          icon={<Zap className="w-4 h-4" />}
          color="amber"
          hint={stageStats ? `${stageStats.startedTodayTotal} stage operations` : undefined}
        />
        <StatCard
          label="In Progress"
          value={stageStats ? stageStats.machinesInProgress : '—'}
          icon={<Activity className="w-4 h-4" />}
          color="green"
          hint={stageStats ? `${stageStats.inProgressTotal} stage operations` : 'Mid-operation right now'}
        />
        <StatCard
          label="Last Sync"
          value={syncStatus ? (syncStatus.lastSyncAt ? formatDateTime(syncStatus.lastSyncAt) : 'Never') : 'Admin only'}
          icon={<Clock className="w-4 h-4" />}
          color="slate"
        />
        <StatCard
          label="Schedule"
          value={syncStatus ? (syncStatus.scheduler?.cronExpression || 'N/A') : 'Admin only'}
          icon={<Calendar className="w-4 h-4" />}
          color="blue"
        />
      </div>

      {demoAvailable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] text-purple-800">
            <span className="inline-flex items-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Demo
            </span>
            <span>
              {includeDemo
                ? `${demoCount} demo machine${demoCount === 1 ? '' : 's'} with sample stage history are included in the counts above.`
                : 'Demo machines with sample stage history are hidden from the list and counts.'}
            </span>
          </span>
          <button
            onClick={() => setIncludeDemo((v) => !v)}
            className="rounded-md border border-purple-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-purple-800 transition-colors hover:bg-purple-100"
          >
            {includeDemo ? 'Hide demo data' : 'Show demo data'}
          </button>
        </div>
      )}

      {syncStatus?.scheduler?.lastSyncResult?.window && (
        <p className="text-[11px] text-slate-500">
          Each sync reads {syncStatus.scheduler.lastSyncResult.window.days} days of production orders
          ({syncStatus.scheduler.lastSyncResult.window.from} to {syncStatus.scheduler.lastSyncResult.window.to}) and
          de-duplicates orders that the plant repeats across days. Days with no published orders are skipped.
        </p>
      )}

      {/* Stage Filter Pipeline */}
      <SectionCard title="Assembly Pipeline">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setSelectedStage(null)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedStage === null ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>All</button>
          {Array.from({ length: 18 }, (_, i) => i + 1).map(s => {
            const count = inAssembly.filter(m => m.assemblyStage === s).length;
            return (
              <button key={s} onClick={() => setSelectedStage(s)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${selectedStage === s ? 'bg-indigo-600 text-white shadow-sm' : count > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                {s}
                {count > 0 && <span className={`text-[10px] px-1 py-0 rounded-full ${selectedStage === s ? 'bg-white/20' : 'bg-blue-200 text-blue-800'}`}>{count}</span>}
              </button>
            );
          })}
          <button
            onClick={() => { setSelectedStage('completed'); setCompletedFilter('ALL'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${showingCompleted ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'}`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed
            <span className={`text-[10px] px-1 py-0 rounded-full ${showingCompleted ? 'bg-white/20' : 'bg-emerald-200 text-emerald-800'}`}>{completed.length}</span>
          </button>
        </div>

        {showingCompleted && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Completed — where they are now</p>
            <div className="flex flex-wrap gap-1.5">
              {COMPLETED_FILTERS.map(f => {
                const count = completed.filter(m => f.match(m.parkStatus)).length;
                const active = completedFilter === f.value;
                return (
                  <button
                    key={f.value}
                    onClick={() => setCompletedFilter(f.value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : `${f.tone} hover:opacity-80`} ${count === 0 && !active ? 'opacity-50' : ''}`}
                  >
                    {f.label}
                    <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Machines Table */}
      <SectionCard
        title={`Machines (${filtered.length})`}
        description={
          showingCompleted
            ? `Completed${completedFilter === 'ALL' ? '' : ` · ${COMPLETED_FILTERS.find(f => f.value === completedFilter)!.label}`}`
            : selectedStage ? `Filtered to Stage ${selectedStage}` : 'All machines still in assembly'
        }
        action={
          <div className="w-full sm:w-72">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search serial, order no, or barcode…"
              icon={<Search className="h-3.5 w-3.5" />}
              aria-label="Search machines by serial number, order number, or barcode"
              className="pr-8"
            />
          </div>
        }
      >
        {term && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
            <span className="text-[11px] text-slate-600">
              {filtered.length} match{filtered.length === 1 ? '' : 'es'} for <span className="font-mono font-medium text-slate-900">{search.trim()}</span>
              {showingCompleted ? ' in Completed' : selectedStage ? ` at stage ${selectedStage}` : ' in assembly'}
            </span>
            <button
              onClick={() => setSearch('')}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-6">
            {term ? `No machines match "${search.trim()}"` : showingCompleted ? 'No completed machines in this group' : 'No machines at this stage'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Model</TableHeaderCell>
              <TableHeaderCell>Order No</TableHeaderCell>
              <TableHeaderCell>Stage</TableHeaderCell>
              <TableHeaderCell>Park Status</TableHeaderCell>
              {showingCompleted && <TableHeaderCell>Location</TableHeaderCell>}
              <TableHeaderCell>Model-Type</TableHeaderCell>
              <TableHeaderCell>Last Sync</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {filtered.map(m => (
                <TableRow
                  key={m.id}
                  onClick={() => setHistoryMachineId(m.id)}
                >
                  <TableCell>
                    <div>
                      <span className="font-medium text-slate-900">{m.serialNumber}</span>
                      {m.barcode && <span className="block text-[10px] text-slate-400">BC: {m.barcode}</span>}
                      {m.isDemo && (
                        <span className="mt-0.5 inline-block rounded bg-purple-100 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-purple-700">
                          Demo
                        </span>
                      )}
                      {m.assemblyStage >= 18 && !m.barcode && (
                        <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700">
                          No barcode
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{m.model}</TableCell>
                  <TableCell><span className="text-xs font-mono text-slate-600">{m.orderNo || '—'}</span></TableCell>
                  <TableCell>
                    <AssemblyStageBadge stage={m.assemblyStage} completed={!!m.assemblyCompleted} />
                    {!m.assemblyCompleted && <PlantStatusTag status={m.plantStatus} />}
                  </TableCell>
                  <TableCell><ParkStatusBadge status={m.parkStatus} /></TableCell>
                  {showingCompleted && (
                    <TableCell>
                      {locationLabel(m) ? (
                        <span className="inline-flex items-center gap-1 text-[13px]">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {locationLabel(m)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {m.modelType ? (
                      <Badge>{m.modelType}</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell><span className="text-xs text-slate-400">{formatDateTime(m.lastSyncAt)}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-[11px] text-slate-400">Select a machine row to view its full stage history.</p>
      </SectionCard>

      {/* Stage Distribution */}
      {stageStats && Object.keys(stageStats.byStage).length > 0 && (
        <SectionCard
          title="Machines by Stage"
          description="Where machines sit now, plus stage operations started today and mid-operation"
        >
          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-9 gap-2">
            {Object.entries(stageStats.byStage)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([stage, stat]) => (
                <div key={stage} className="p-2.5 bg-slate-50 rounded-lg text-center border border-slate-100">
                  {/* Completed machines are counted in their own tile, not under stage 18. */}
                  <p className="text-base font-bold text-slate-900 tabular-nums">{Math.max(0, stat.total - completed.filter(m => m.assemblyStage === Number(stage)).length)}</p>
                  <p className="text-[10px] text-slate-500 font-medium">Stage {stage}</p>
                  {(stat.startedToday > 0 || stat.inProgress > 0) && (
                    <div className="mt-1 space-y-0.5 border-t border-slate-200 pt-1">
                      {stat.startedToday > 0 && (
                        <p className="text-[10px] font-semibold text-amber-700 tabular-nums">
                          {stat.startedToday} ops
                        </p>
                      )}
                      {stat.inProgress > 0 && (
                        <p className="text-[10px] font-semibold text-emerald-700 tabular-nums">
                          {stat.inProgress} active
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            <button
              type="button"
              onClick={() => { setSelectedStage('completed'); setCompletedFilter('ALL'); }}
              className="p-2.5 bg-emerald-50 rounded-lg text-center border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              <p className="text-base font-bold text-emerald-800 tabular-nums">{completed.length}</p>
              <p className="text-[10px] text-emerald-700 font-medium">Completed</p>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="font-semibold text-amber-700 tabular-nums">{stageStats.machinesStartedToday}</span>
              machines started today ({stageStats.startedTodayTotal} stage operations)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="font-semibold text-emerald-700 tabular-nums">{stageStats.machinesInProgress}</span>
              machines in progress ({stageStats.inProgressTotal} stage operations)
            </span>
          </div>
        </SectionCard>
      )}

      <StageHistoryModal
        machineId={historyMachineId}
        onClose={() => setHistoryMachineId(null)}
      />
    </div>
  );
}

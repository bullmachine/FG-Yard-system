'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { SectionCard, StatCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Input from '@/components/ui/Input';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { AssemblyStageBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import Badge from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import StageHistoryModal from '@/components/StageHistoryModal';
import { formatDateTime } from '@/lib/format';
import { RefreshCw, Factory, Clock, Zap, Activity, Calendar, AlertCircle, CheckCircle2, Search, X } from 'lucide-react';

interface Machine { id: string; serialNumber: string; barcode?: string; model: string; machineType?: string; modelType?: string; assemblyStage: number; orderNo?: string; itemCode?: string; itemDescription?: string; parkStatus: string; lastSyncAt?: string; isDemo?: boolean; }
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

export default function AssemblyLine() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
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
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchMachines = async () => {
    try { const r = await fetch(`${API_URL}/api/machines?includeDemo=${includeDemo}`, { headers: headers() }); const d = await r.json(); setMachines(d.filter((m: Machine) => m.assemblyStage > 0)); } catch { } finally { setLoading(false); }
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
          fetch(`${API_URL}/api/machines?includeDemo=${includeDemo}`, { headers: headers() }),
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

  const filtered = selectedStage ? searched.filter(m => m.assemblyStage === selectedStage) : searched;
  // Only meaningful while demo rows are visible; the banner text falls back to
  // the availability flag when they are hidden.
  const demoCount = machines.filter(m => m.isDemo).length;

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assembly Line"
        description="Track machines through stages 1–18"
        actions={isAdmin ? (
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="In Assembly" value={machines.length} icon={<Factory className="w-4 h-4" />} color="indigo" />
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
            <span className="inline-flex items-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
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
            const count = machines.filter(m => m.assemblyStage === s).length;
            return (
              <button key={s} onClick={() => setSelectedStage(s)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${selectedStage === s ? 'bg-indigo-600 text-white shadow-sm' : count > 0 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                {s}
                {count > 0 && <span className={`text-[9px] px-1 py-0 rounded-full ${selectedStage === s ? 'bg-white/20' : 'bg-blue-200 text-blue-800'}`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Machines Table */}
      <SectionCard
        title={`Machines (${filtered.length})`}
        description={selectedStage ? `Filtered to Stage ${selectedStage}` : 'All assembly stages'}
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
              {searched.length} match{searched.length === 1 ? '' : 'es'} for <span className="font-mono font-medium text-slate-900">{search.trim()}</span>
              {selectedStage && ` at stage ${selectedStage}`}
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
            {term ? `No machines match "${search.trim()}"` : 'No machines at this stage'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Model</TableHeaderCell>
              <TableHeaderCell>Order No</TableHeaderCell>
              <TableHeaderCell>Stage</TableHeaderCell>
              <TableHeaderCell>Park Status</TableHeaderCell>
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
                        <span className="mt-0.5 inline-block rounded bg-purple-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-purple-700">
                          Demo
                        </span>
                      )}
                      {m.assemblyStage >= 18 && !m.barcode && (
                        <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700">
                          No barcode
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{m.model}</TableCell>
                  <TableCell><span className="text-xs font-mono text-slate-600">{m.orderNo || '—'}</span></TableCell>
                  <TableCell><AssemblyStageBadge stage={m.assemblyStage} /></TableCell>
                  <TableCell><ParkStatusBadge status={m.parkStatus} /></TableCell>
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
                  <p className="text-base font-bold text-slate-900 tabular-nums">{stat.total}</p>
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

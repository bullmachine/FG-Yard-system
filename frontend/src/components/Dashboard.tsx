'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeEvent } from '@/contexts/NotificationContext';
import { StatCard, SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { ParkStatusBadge, SlotStatusBadge } from '@/components/ui/StatusBadge';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { TrendChart, ActivityFeed, PlanProgress, TrendDay, ActivityItem, OpenPlan } from '@/components/DashboardWidgets';
import { slotLabel, formatDateTime } from '@/lib/format';
import {
  Truck, MapPin, Package, CheckCircle2, Search, ArrowRight, Map, RefreshCw, AlertTriangle,
  Clock, Send, ShieldAlert, Fence, Shield, Boxes, ClipboardList, LogOut, Undo2, CalendarDays, PauseCircle
} from 'lucide-react';

/**
 * Main dashboard: FG yard only. Assembly is left out on purpose; the yard's story starts
 * when a machine is released to the yard and ends when it leaves through the main gate.
 * All counts come from one call, /api/dashboard.
 */

interface YardMachine {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string;
  parkStatus: string;
  yard: string | null;
  row: number | null;
  col: number | null;
  slotReservedOnly: boolean;
  driver: string | null;
  since: string | null;
  daysInYard?: number | null;
}

interface DispatchMachine {
  id: string;
  status: string;
  planNo: string;
  modelType: string;
  serialNumber: string;
  model: string;
  driver: string | null;
  gateOutAt: string | null;
  overdue: boolean;
  pdiStatus?: string | null;
}

interface Capped<T> { count: number; items: T[] }

interface YardSummary {
  id: string;
  name: string;
  totalSlots: number;
  slotCounts: Record<string, number>;
}

interface DashboardData {
  generatedAt: string;
  settings: { inTransitAlertMinutes: number; dispatchAlertHours: number };
  slots: { total: number; available: number; reserved: number; occupied: number; dispatchReady: number };
  yards: YardSummary[];
  today: { gateIn: number; gateOut: number; mainGateOut: number };
  inbound: {
    readyToMove: Capped<YardMachine>;
    inTransit: Capped<YardMachine>;
    stuck: Capped<YardMachine>;
    awaitingVerify: Capped<YardMachine>;
    rejected: Capped<YardMachine>;
  };
  stock: {
    inYard: Capped<YardMachine>;
    free: Capped<YardMachine>;
    planned: Capped<YardMachine>;
    returnHold: Capped<YardMachine>;
    exitPending: number;
    byModelType: { modelType: string; total: number; free: number; planned: number; oldestDays: number | null }[];
    ageBands: { label: string; count: number }[];
    undated: number;
  };
  dispatch: {
    toLoad: Capped<DispatchMachine>;
    awaitingMainGate: Capped<DispatchMachine>;
    overdue: Capped<DispatchMachine>;
    pdiHold: Capped<DispatchMachine>;
    openPlans: { count: number; items: OpenPlan[] };
  };
  trend: TrendDay[];
  activity: ActivityItem[];
  exitRequestsPending: number;
}

type ModalView =
  | { type: 'machine'; data: any }
  | { type: 'machines'; list: Capped<YardMachine>; title: string }
  | { type: 'dispatch'; list: Capped<DispatchMachine>; title: string }
  | { type: 'slots'; list: any[] }
  | null;

// Every capped list says how much it hid, so a short list is never mistaken for
// the whole picture. The server caps its lists at 50.
const LIST_CAP = 8;

// The dashboard is left open on yard screens, so it re-reads on a timer as well
// as on the realtime events it can hear.
const AUTO_REFRESH_MS = 60_000;

// Machines that have never been released to the yard are assembly's, not the yard's.
const NOT_IN_FG = 'PLANNED';

interface DashboardProps {
  onNavigate?: (tab: string) => void;
  allowedTabs?: string[];
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function location(m: { yard: string | null; row: number | null; col: number | null; slotReservedOnly?: boolean }) {
  if (!m.yard || m.row === null || m.col === null) return 'No slot';
  return `${m.slotReservedOnly ? 'Reserved ' : ''}${m.yard} (${slotLabel(m.row, m.col)})`;
}

// A full machine row from /api/machines, as used by search and the detail modal.
function machineLocation(machine: any): string {
  if (machine?.currentSlot) return `${machine.currentSlot.yard.name} (${slotLabel(machine.currentSlot.row, machine.currentSlot.col)})`;
  if (machine?.plannedSlot) return `Reserved ${machine.plannedSlot.yard.name} (${slotLabel(machine.plannedSlot.row, machine.plannedSlot.col)})`;
  return 'Not in a slot';
}

function elapsed(iso: string | null) {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ${mins % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

function MoreHint({ total, cap, label }: { total: number; cap: number; label: string }) {
  if (total <= cap) return null;
  return <p className="px-2 pt-1.5 text-[11px] font-medium text-slate-500">+{total - cap} more {label}</p>;
}

export default function Dashboard({ onNavigate, allowedTabs }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchPool, setSearchPool] = useState<any[] | null>(null);
  const [modalView, setModalView] = useState<ModalView>(null);
  const [machineHistory, setMachineHistory] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const can = (tab: string) => !allowedTabs || allowedTabs.includes(tab);

  // A refresh triggered by a realtime event or the timer must not blank the page,
  // so only the first load owns the loading spinner.
  const fetchDashboard = useCallback(async (initial: boolean) => {
    if (!initial) setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/dashboard`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET /api/dashboard -> ${res.status}`);
      setData(await res.json());
      setError(null);
      // Search reloads its machine list on next use, so it never shows stale slots.
      setSearchPool(null);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setError('Could not load yard data. Check that the backend is running, then retry.');
    } finally {
      if (initial) setLoading(false);
      setRefreshing(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchDashboard(true);
    const timer = setInterval(() => fetchDashboard(false), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  useRealtimeEvent('security-queue', () => { fetchDashboard(false); });
  useRealtimeEvent('exit-request', () => { fetchDashboard(false); });
  useRealtimeEvent('notification', () => { fetchDashboard(false); });

  // Search loads the machine list only when someone types, and keeps FG yard machines.
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2 || searchPool) return;
    try {
      const res = await fetch(`${API_URL}/api/machines`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET /api/machines -> ${res.status}`);
      const all = await res.json();
      setSearchPool(Array.isArray(all) ? all.filter((m: any) => m.parkStatus && m.parkStatus !== NOT_IN_FG) : []);
    } catch (err) {
      console.error('Failed to load machines for search:', err);
      setSearchPool([]);
    }
  };

  const needle = searchQuery.toLowerCase();
  const searchResults = searchQuery.length >= 2 && searchPool
    ? searchPool.filter((m: any) =>
        m.serialNumber?.toLowerCase().includes(needle) ||
        m.model?.toLowerCase().includes(needle) ||
        m.modelType?.toLowerCase().includes(needle) ||
        m.barcode?.toLowerCase().includes(needle))
    : [];

  const handleViewDetails = async (machineId: string) => {
    setModalView({ type: 'machine', data: null });
    setMachineHistory([]);
    try {
      const res = await fetch(`${API_URL}/api/machines/${machineId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET /api/machines/${machineId} -> ${res.status}`);
      const detail = await res.json();
      setModalView({ type: 'machine', data: detail });
      setMachineHistory(detail.movements || []);
    } catch (err) {
      console.error('Failed to load machine detail:', err);
      setModalView(null);
    }
  };

  const openMachines = (title: string, list: Capped<YardMachine>) => setModalView({ type: 'machines', list, title });
  const openDispatch = (title: string, list: Capped<DispatchMachine>) => setModalView({ type: 'dispatch', list, title });

  const openFreeSlots = async () => {
    if (!data) return;
    setDetailLoading(true);
    setModalView({ type: 'slots', list: [] });
    try {
      const headers = authHeaders();
      const details = await Promise.all(
        data.yards.map(async (yard) => {
          const res = await fetch(`${API_URL}/api/yards/${yard.id}`, { headers });
          if (!res.ok) throw new Error(`GET /api/yards/${yard.id} -> ${res.status}`);
          return { yard, detail: await res.json() };
        })
      );
      setModalView({
        type: 'slots',
        list: details.flatMap(({ yard, detail }) =>
          (detail.slots || []).filter((s: any) => s.status === 'AVAILABLE').map((s: any) => ({ ...s, yardName: yard.name }))),
      });
    } catch (err) {
      console.error('Failed to load slots:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => { setModalView(null); setMachineHistory([]); };

  const quickActions = [
    { tab: 'yards', label: 'FG Yard', hint: 'View and manage yard slots', icon: <Map className="w-3.5 h-3.5 text-blue-600" />, iconWrap: 'bg-blue-100 group-hover:bg-blue-200', hover: 'hover:bg-blue-50 hover:border-blue-200', arrow: 'group-hover:text-blue-600' },
    { tab: 'stock', label: 'Yard Stock', hint: 'Stock by model-type in FIFO order', icon: <Boxes className="w-3.5 h-3.5 text-teal-600" />, iconWrap: 'bg-teal-100 group-hover:bg-teal-200', hover: 'hover:bg-teal-50 hover:border-teal-200', arrow: 'group-hover:text-teal-600' },
    { tab: 'dispatch', label: 'Dispatch Planning', hint: 'Plan machines for dispatch', icon: <ClipboardList className="w-3.5 h-3.5 text-indigo-600" />, iconWrap: 'bg-indigo-100 group-hover:bg-indigo-200', hover: 'hover:bg-indigo-50 hover:border-indigo-200', arrow: 'group-hover:text-indigo-600' },
    { tab: 'pdi', label: 'Dispatch Machine List', hint: 'Drivers, slip and main gate out', icon: <Truck className="w-3.5 h-3.5 text-emerald-600" />, iconWrap: 'bg-emerald-100 group-hover:bg-emerald-200', hover: 'hover:bg-emerald-50 hover:border-emerald-200', arrow: 'group-hover:text-emerald-600' },
    { tab: 'gate', label: 'Gate Control', hint: 'Check machines in and out', icon: <Fence className="w-3.5 h-3.5 text-slate-600" />, iconWrap: 'bg-slate-100 group-hover:bg-slate-200', hover: 'hover:bg-slate-50 hover:border-slate-300', arrow: 'group-hover:text-slate-700' },
    { tab: 'parked', label: 'Confirm Parking', hint: 'Confirm a machine parked in its slot', icon: <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />, iconWrap: 'bg-amber-100 group-hover:bg-amber-200', hover: 'hover:bg-amber-50 hover:border-amber-200', arrow: 'group-hover:text-amber-600' },
    { tab: 'security', label: 'Security Verification', hint: 'Approve or reject parked machines', icon: <Shield className="w-3.5 h-3.5 text-red-600" />, iconWrap: 'bg-red-100 group-hover:bg-red-200', hover: 'hover:bg-red-50 hover:border-red-200', arrow: 'group-hover:text-red-600' },
    { tab: 'requests', label: 'Exit Requests', hint: 'Request or approve machines leaving', icon: <Send className="w-3.5 h-3.5 text-sky-600" />, iconWrap: 'bg-sky-100 group-hover:bg-sky-200', hover: 'hover:bg-sky-50 hover:border-sky-200', arrow: 'group-hover:text-sky-600' },
  ].filter((action) => can(action.tab)).slice(0, 4);

  if (loading) return <PageSpinner />;

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title={`Welcome back, ${user?.name || 'User'}`} description="FG yard at a glance." />
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800 flex-1">{error}</p>
          <button onClick={() => fetchDashboard(false)} className="flex items-center gap-1.5 text-xs font-medium text-amber-900 hover:underline">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const { inbound, stock, dispatch, slots, today } = data;
  const tabName: Record<string, string> = {
    yards: 'FG Yard', parked: 'Confirm Parking', security: 'Security Verification',
    stock: 'Yard Stock', pdi: 'Dispatch Machine List', requests: 'Exit Requests',
  };

  // Only problems that need a person to act. Each one opens its list, and the
  // button jumps to the screen where it is fixed when this role can reach it.
  const attention = [
    dispatch.overdue.count > 0 && {
      key: 'overdue', count: dispatch.overdue.count, icon: <AlertTriangle className="w-4 h-4" />,
      title: 'Dispatch overdue at main gate',
      hint: `Out of the FG yard over ${data.settings.dispatchAlertHours} h, not through the main gate`,
      tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'bg-red-600',
      onOpen: () => openDispatch('Overdue at main gate', dispatch.overdue), tab: 'pdi',
    },
    dispatch.pdiHold.count > 0 && {
      key: 'pdihold', count: dispatch.pdiHold.count, icon: <PauseCircle className="w-4 h-4" />,
      title: 'PDI hold',
      hint: 'Out of the FG yard, held by PDI until rectified',
      tone: 'border-amber-200 bg-amber-50 text-amber-800', iconTone: 'bg-amber-600',
      onOpen: () => openDispatch('PDI hold', dispatch.pdiHold), tab: 'pdi',
    },
    inbound.stuck.count > 0 && {
      key: 'stuck', count: inbound.stuck.count, icon: <Clock className="w-4 h-4" />,
      title: 'Parking not confirmed',
      hint: `In transit over ${data.settings.inTransitAlertMinutes} min after gate in`,
      tone: 'border-orange-200 bg-orange-50 text-orange-800', iconTone: 'bg-orange-600',
      onOpen: () => openMachines('Parking not confirmed', inbound.stuck), tab: 'parked',
    },
    inbound.rejected.count > 0 && {
      key: 'rejected', count: inbound.rejected.count, icon: <ShieldAlert className="w-4 h-4" />,
      title: 'Parking rejected',
      hint: 'Must be re-parked and confirmed again',
      tone: 'border-amber-200 bg-amber-50 text-amber-800', iconTone: 'bg-amber-600',
      onOpen: () => openMachines('Parking rejected', inbound.rejected), tab: 'parked',
    },
    stock.returnHold.count > 0 && {
      key: 'hold', count: stock.returnHold.count, icon: <Undo2 className="w-4 h-4" />,
      title: 'Returned after dispatch',
      hint: 'On hold until a manager clears them for dispatch',
      tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'bg-red-600',
      onOpen: () => openMachines('Returned after dispatch (on hold)', stock.returnHold), tab: 'stock',
    },
    slots.available === 0 && data.yards.length > 0 && {
      key: 'full', count: 0, icon: <AlertTriangle className="w-4 h-4" />,
      title: 'All yards are full',
      hint: 'No slot is free for the next machine',
      tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'bg-red-600',
      onOpen: () => onNavigate?.('yards'), tab: 'yards',
    },
    can('requests') && data.exitRequestsPending > 0 && {
      key: 'requests', count: data.exitRequestsPending, icon: <Send className="w-4 h-4" />,
      title: 'Exit requests pending',
      hint: 'Waiting for a yard manager decision',
      tone: 'border-sky-200 bg-sky-50 text-sky-800', iconTone: 'bg-sky-600',
      onOpen: () => onNavigate?.('requests'), tab: 'requests',
    },
  ].filter(Boolean) as {
    key: string; count: number; icon: React.ReactNode; title: string; hint: string;
    tone: string; iconTone: string; onOpen: () => void; tab: string;
  }[];

  // FG yard flow, left to right: released to the yard, through to the main gate.
  const flow = [
    { key: 'ready', label: 'Ready to Move', count: inbound.readyToMove.count, tone: 'border-indigo-200 bg-indigo-50 text-indigo-800', open: () => openMachines('Ready to Move', inbound.readyToMove) },
    { key: 'transit', label: 'In Transit / Gate', count: inbound.inTransit.count, tone: 'border-blue-200 bg-blue-50 text-blue-800', open: () => openMachines('In Transit / Gate', inbound.inTransit) },
    { key: 'verify', label: 'Awaiting Verify', count: inbound.awaitingVerify.count + inbound.rejected.count, tone: 'border-amber-200 bg-amber-50 text-amber-800', open: () => openMachines('Awaiting Verification', { count: inbound.awaitingVerify.count + inbound.rejected.count, items: [...inbound.awaitingVerify.items, ...inbound.rejected.items] }) },
    { key: 'free', label: 'Free Stock', count: stock.free.count, tone: 'border-teal-200 bg-teal-50 text-teal-800', open: () => openMachines('Free Stock (FIFO)', stock.free) },
    { key: 'planned', label: 'Planned', count: dispatch.toLoad.count, tone: 'border-violet-200 bg-violet-50 text-violet-800', open: () => openDispatch('Planned for dispatch', dispatch.toLoad) },
    { key: 'fgout', label: 'Out of FG Yard', count: dispatch.awaitingMainGate.count, tone: dispatch.overdue.count > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-sky-200 bg-sky-50 text-sky-800', open: () => openDispatch('Out of FG yard, awaiting main gate', dispatch.awaitingMainGate) },
    { key: 'maingate', label: 'Main Gate Out Today', count: today.mainGateOut, tone: 'border-slate-200 bg-slate-50 text-slate-700', open: () => can('pdi') && onNavigate?.('pdi') },
  ];

  const maxBand = Math.max(1, ...stock.ageBands.map((b) => b.count));

  const machineList = (list: Capped<YardMachine>, dot: string, wrapper: string, empty: string, renderSub: (m: YardMachine) => string) => (
    list.count === 0 ? (
      <p className="text-sm text-slate-500 text-center py-3">{empty}</p>
    ) : (
      <>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {list.items.slice(0, LIST_CAP).map((m) => (
            <button type="button" key={m.id} onClick={() => handleViewDetails(m.id)} className={`w-full flex items-center justify-between gap-2 p-2 rounded-md text-left ${wrapper}`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                  <p className="text-xs text-slate-500 truncate">{renderSub(m)}</p>
                </div>
              </div>
              <div className="shrink-0"><ParkStatusBadge status={m.parkStatus} /></div>
            </button>
          ))}
        </div>
        <MoreHint total={list.count} cap={LIST_CAP} label="machines not shown" />
      </>
    )
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title={`Welcome back, ${user?.name || 'User'}`}
        description="FG yard at a glance: stock, inward and dispatch."
        actions={
          <>
            <p className="text-xs text-slate-500 hidden sm:block tabular-nums">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <button
              onClick={() => fetchDashboard(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              title="Refresh now (also refreshes every minute)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {`Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800 flex-1">{error}</p>
          <button onClick={() => fetchDashboard(false)} className="flex items-center gap-1.5 text-xs font-medium text-amber-900 hover:underline">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <StatCard label="In FG Yard" value={stock.inYard.count} icon={<Package className="w-4 h-4" />} color="blue" hint={`${stock.byModelType.length} model-types`} onClick={() => openMachines('In FG Yard (FIFO)', stock.inYard)} />
        <StatCard label="Free Stock" value={stock.free.count} icon={<Boxes className="w-4 h-4" />} color="green" hint="Ready to plan" onClick={() => openMachines('Free Stock (FIFO)', stock.free)} />
        <StatCard label="Planned" value={dispatch.toLoad.count} icon={<ClipboardList className="w-4 h-4" />} color="indigo" hint="To leave FG yard" onClick={() => openDispatch('Planned for dispatch', dispatch.toLoad)} />
        <StatCard label="At Main Gate" value={dispatch.awaitingMainGate.count} icon={<LogOut className="w-4 h-4" />} color={dispatch.overdue.count > 0 ? 'red' : 'amber'} hint={dispatch.overdue.count > 0 ? `${dispatch.overdue.count} overdue` : 'Out of FG yard'} onClick={() => openDispatch('Out of FG yard, awaiting main gate', dispatch.awaitingMainGate)} />
        <StatCard label="Free Slots" value={slots.available} icon={<MapPin className="w-4 h-4" />} color={slots.available === 0 ? 'red' : 'green'} hint={`of ${slots.total} in ${data.yards.length} yard${data.yards.length === 1 ? '' : 's'}`} onClick={openFreeSlots} />
        <StatCard label="Today In/Out" value={`${today.gateIn} / ${today.gateOut}`} icon={<CalendarDays className="w-4 h-4" />} color="slate" hint={`Main gate: ${today.mainGateOut}`} />
      </div>

      {/* Needs attention: one row of chips; each opens its list. */}
      {attention.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-medium text-emerald-800">All clear. Nothing needs attention right now.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Needs attention
            </span>
            {attention.map((a) => (
              <div key={a.key} className={`group flex items-center rounded-lg border ${a.tone}`}>
                <button type="button" onClick={a.onOpen} title={a.hint} className="flex items-center gap-2 py-1.5 pl-1.5 pr-2.5 text-left">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white [&>svg]:h-3.5 [&>svg]:w-3.5 ${a.iconTone}`}>{a.icon}</span>
                  {a.count > 0 && <span className="text-sm font-bold tabular-nums leading-none">{a.count}</span>}
                  <span className="text-xs font-semibold">{a.title}</span>
                </button>
                {can(a.tab) && onNavigate && (
                  <button type="button" onClick={() => onNavigate(a.tab)} title={`Open ${tabName[a.tab]}`} aria-label={`Open ${tabName[a.tab]}`}
                    className="flex h-full items-center border-l border-current/15 px-2 py-1.5 opacity-60 transition-opacity hover:opacity-100">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FG yard flow: one count per step, left to right, filling the width. */}
      <SectionCard title="FG Yard Flow" description="From release to the yard, through dispatch, to the main gate">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {flow.map((step, index) => (
            <li key={step.key} className="relative">
              <button
                type="button"
                onClick={step.open}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-sm ${step.tone} ${step.count === 0 ? 'opacity-60' : ''}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-xl font-bold tabular-nums leading-tight">{step.count}</span>
                  <span className="text-[10px] font-semibold opacity-50">{index + 1}</span>
                </span>
                <span className="block truncate text-[11px] font-medium">{step.label}</span>
              </button>
              {index < flow.length - 1 && (
                <span className="pointer-events-none absolute -right-[7px] top-1/2 z-10 hidden h-3 w-3 -translate-y-1/2 rotate-45 border-r border-t border-slate-300 bg-white xl:block" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* Trend and live activity */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard className="h-full" title="Last 7 Days" description="Machines through the FG gate and the main gate, per day">
            <TrendChart days={data.trend} />
          </SectionCard>
        </div>
        <SectionCard className="h-full" title="Activity" description="Latest yard events, newest first" bodyClassName="max-h-[280px] overflow-y-auto">
          <ActivityFeed items={data.activity} />
        </SectionCard>
      </div>

      {/* Dispatch progress and stock age */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard
            className="h-full"
            title="Open Dispatch Plans"
            description={`${dispatch.openPlans.count} plan${dispatch.openPlans.count === 1 ? '' : 's'} with machines still on the way, oldest first`}
          >
            <PlanProgress plans={dispatch.openPlans.items} total={dispatch.openPlans.count} now={Date.parse(data.generatedAt)} onOpen={can('dispatch') && onNavigate ? () => onNavigate('dispatch') : undefined} />
          </SectionCard>
        </div>
        <SectionCard className="h-full" title="Stock Age" description="Days since first inward, all machines in the yard">
          <div className="space-y-2.5">
            {stock.ageBands.map((b, i) => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{b.label}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{b.count}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${i === 3 ? 'bg-red-400' : i === 2 ? 'bg-amber-400' : 'bg-teal-400'}`} style={{ width: `${(b.count / maxBand) * 100}%` }} />
                </div>
              </div>
            ))}
            {stock.undated > 0 && <p className="text-[11px] text-slate-500">{stock.undated} machine{stock.undated === 1 ? '' : 's'} with no inward date</p>}
            {stock.exitPending > 0 && <p className="text-[11px] text-slate-500">{stock.exitPending} on an open exit request</p>}
          </div>
        </SectionCard>
      </div>

      {/* Stock by model-type, with search and shortcuts beside it */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard className="h-full" title="Stock by Model-Type" description="Machines in the FG yard; oldest free age is from first inward">
            {stock.byModelType.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-3">No machines in the FG yard</p>
            ) : (
              <Table maxHeight={300}>
                <TableHeader sticky>
                  <TableHeaderCell>Model-Type</TableHeaderCell>
                  <TableHeaderCell align="right">In Yard</TableHeaderCell>
                  <TableHeaderCell align="right">Free</TableHeaderCell>
                  <TableHeaderCell align="right">Planned</TableHeaderCell>
                  <TableHeaderCell align="right">Oldest Free</TableHeaderCell>
                </TableHeader>
                <TableBody>
                  {stock.byModelType.map((g) => (
                    <TableRow key={g.modelType} onClick={can('stock') ? () => onNavigate?.('stock') : undefined}>
                      <TableCell className="text-[13px] font-medium text-slate-900">
                        {g.modelType}
                        <span className="mt-1 flex h-1.5 w-full max-w-[160px] overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                          <span className="bg-emerald-500" style={{ width: `${(g.free / Math.max(1, g.total)) * 100}%` }} />
                          <span className="bg-indigo-400" style={{ width: `${(g.planned / Math.max(1, g.total)) * 100}%` }} />
                        </span>
                      </TableCell>
                      <TableCell align="right" className="text-[13px] tabular-nums">{g.total}</TableCell>
                      <TableCell align="right" className={`text-[13px] tabular-nums font-semibold ${g.free > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{g.free}</TableCell>
                      <TableCell align="right" className="text-[13px] tabular-nums text-indigo-700">{g.planned || '—'}</TableCell>
                      <TableCell align="right" className={`text-[13px] tabular-nums ${g.oldestDays !== null && g.oldestDays > 30 ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                        {g.oldestDays === null ? '—' : `${g.oldestDays} d`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </div>

        <SectionCard className="h-full" title="Find & Go" description="Search FG yard machines, or jump to a screen">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Serial, model, model-type or barcode..."
            icon={<Search className="w-4 h-4" />}
          />
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1 max-h-56 overflow-y-auto">
              {searchResults.slice(0, LIST_CAP).map((m: any) => (
                <button type="button" key={m.id} onClick={() => handleViewDetails(m.id)} className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-900">{m.serialNumber}</span>
                    <span className="block truncate text-xs text-slate-500">{m.model || 'N/A'} — {machineLocation(m)}</span>
                  </span>
                  <span className="shrink-0"><ParkStatusBadge status={m.parkStatus} /></span>
                </button>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && searchPool && searchResults.length === 0 && (
            <p className="text-xs text-slate-500 mt-2 text-center">No FG yard machines found for &quot;{searchQuery}&quot;</p>
          )}
          <MoreHint total={searchResults.length} cap={LIST_CAP} label="matches not shown — keep typing to narrow" />
          {quickActions.length > 0 && searchQuery.length < 2 && (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {quickActions.map((action) => (
                <button
                  key={action.tab}
                  onClick={() => onNavigate?.(action.tab)}
                  title={action.hint}
                  className={`group flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-left transition-colors ${action.hover}`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${action.iconWrap}`}>{action.icon}</span>
                  <span className="min-w-0 text-xs font-medium leading-tight text-slate-800">{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Yard capacity */}
      {data.yards.length > 0 && (
        <SectionCard
          title="Yard Capacity"
          description={`${slots.available} of ${slots.total} slots free across ${data.yards.length} yard${data.yards.length === 1 ? '' : 's'}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {data.yards.map((yard) => {
              const total = yard.totalSlots;
              const counts = yard.slotCounts;
              const segments = [
                { key: 'OCCUPIED', label: 'Occupied', bar: 'bg-red-400', text: 'text-red-700' },
                { key: 'RESERVED', label: 'Reserved', bar: 'bg-amber-400', text: 'text-amber-700' },
                { key: 'DISPATCH_READY', label: 'Dispatch', bar: 'bg-indigo-400', text: 'text-indigo-700' },
                { key: 'AVAILABLE', label: 'Free', bar: 'bg-emerald-400', text: 'text-emerald-700' },
              ];
              const other = Math.max(0, total - segments.reduce((sum, s) => sum + (counts[s.key] ?? 0), 0));
              const free = counts.AVAILABLE ?? 0;
              return (
                <button
                  key={yard.id}
                  type="button"
                  onClick={() => can('yards') && onNavigate?.('yards')}
                  className="rounded-lg border border-slate-200 p-3 text-left hover:border-blue-200 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-900 truncate">{yard.name}</p>
                    {free === 0
                      ? <Badge variant="red" dot>Full</Badge>
                      : <span className="text-xs font-semibold text-emerald-700 tabular-nums shrink-0">{free} free</span>}
                  </div>
                  <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    {total > 0 && segments.map((s) => (counts[s.key] ?? 0) > 0 && (
                      <div key={s.key} className={s.bar} style={{ width: `${((counts[s.key] ?? 0) / total) * 100}%` }} />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    {segments.map((s) => (counts[s.key] ?? 0) > 0 && (
                      <span key={s.key}><span className={`font-semibold tabular-nums ${s.text}`}>{counts[s.key]}</span> {s.label}</span>
                    ))}
                    {other > 0 && <span><span className="font-semibold tabular-nums text-slate-700">{other}</span> Other</span>}
                    <span className="ml-auto tabular-nums">{total} slots</span>
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <SectionCard className="h-full" title="In Transit" description="Checked in at the gate, not yet parked">
          {machineList(
            inbound.inTransit, 'bg-blue-500', 'bg-blue-50 border border-blue-200 hover:border-blue-300', 'Nothing on the road',
            (m) => [m.driver ? `Driver ${m.driver}` : location(m), m.since ? `${elapsed(m.since)} ago` : ''].filter(Boolean).join(' · ')
          )}
        </SectionCard>

        <SectionCard className="h-full" title="Awaiting Verification" description="Parked machines a guard still has to check">
          {machineList(
            { count: inbound.awaitingVerify.count + inbound.rejected.count, items: [...inbound.rejected.items, ...inbound.awaitingVerify.items] },
            'bg-amber-500', 'bg-amber-50 border border-amber-200 hover:border-amber-300', 'All clear — nothing awaiting a guard',
            (m) => (m.parkStatus === 'PARKED_REJECTED' ? 'Rejected, waiting to be re-parked' : location(m))
          )}
        </SectionCard>

        <SectionCard className="h-full" title="Awaiting Main Gate" description="Out of the FG yard, not yet out of the plant">
          {dispatch.awaitingMainGate.count === 0 ? (
            <p className="text-sm text-slate-500 text-center py-3">Nothing between the FG yard and the main gate</p>
          ) : (
            <>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {dispatch.awaitingMainGate.items.slice(0, LIST_CAP).map((i) => (
                  <div key={i.id} className={`flex items-center justify-between gap-2 p-2 rounded-md border ${i.overdue ? 'bg-red-50 border-red-200' : 'bg-sky-50 border-sky-200'}`}>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900 truncate">{i.serialNumber}</p>
                      <p className="text-xs text-slate-500 truncate">{i.planNo} · {i.modelType}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold tabular-nums ${i.overdue ? 'text-red-700' : 'text-slate-600'}`}>{elapsed(i.gateOutAt)}</span>
                  </div>
                ))}
              </div>
              <MoreHint total={dispatch.awaitingMainGate.count} cap={LIST_CAP} label="machines not shown" />
            </>
          )}
        </SectionCard>
      </div>

      <Modal
        open={!!modalView}
        onClose={closeModal}
        title={
          modalView?.type === 'machine' ? 'Machine Details' :
          modalView?.type === 'machines' || modalView?.type === 'dispatch' ? `${modalView.title} (${modalView.list.count})` :
          modalView?.type === 'slots' ? 'Free Slots' : ''
        }
        subtitle={modalView?.type === 'machine' ? modalView.data?.serialNumber : undefined}
        size="lg"
      >
        {modalView?.type === 'machine' && (
          !modalView.data ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Serial Number</p>
                  <p className="text-base font-bold text-slate-900">{modalView.data.serialNumber}</p>
                  <p className="text-xs text-slate-500">Model: {modalView.data.model || 'N/A'}{modalView.data.modelType ? ` · ${modalView.data.modelType}` : ''}</p>
                </div>
                <div className="ml-auto shrink-0"><ParkStatusBadge status={modalView.data.parkStatus} /></div>
              </div>

              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-semibold text-slate-700 mb-1">Location</p>
                <p className="text-sm font-medium text-slate-900">{machineLocation(modalView.data)}</p>
              </div>

              {machineHistory.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-1.5">Movement History</p>
                  <Table maxHeight={220}>
                    <TableHeader sticky>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>From</TableHeaderCell>
                      <TableHeaderCell>To</TableHeaderCell>
                      <TableHeaderCell>Reason</TableHeaderCell>
                    </TableHeader>
                    <TableBody>
                      {machineHistory.map((m: any) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs text-slate-500">{formatDateTime(m.timestamp)}</TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {m.fromSlot ? `${m.fromSlot.yard?.name || m.yard.name} (${slotLabel(m.fromSlot.row, m.fromSlot.col)})` : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {m.toSlot ? `${m.toSlot.yard?.name || m.yard.name} (${slotLabel(m.toSlot.row, m.toSlot.col)})` : '—'}
                          </TableCell>
                          <TableCell><Badge variant="blue" size="sm">{m.reason}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )
        )}

        {modalView?.type === 'machines' && (
          <div className="max-h-[420px] overflow-y-auto space-y-1.5">
            {modalView.list.count === 0 ? (
              <p className="text-sm text-slate-500 text-center py-3">No machines</p>
            ) : (
              <>
                {modalView.list.items.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => handleViewDetails(m.id)}
                    className="w-full flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-md border border-slate-200 text-left hover:bg-blue-50 hover:border-blue-200 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                      <p className="text-xs text-slate-500 truncate">{m.modelType} — {location(m)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {m.daysInYard != null && <span className="text-xs tabular-nums text-slate-500">{m.daysInYard} d</span>}
                      <ParkStatusBadge status={m.parkStatus} />
                    </div>
                  </button>
                ))}
                <MoreHint total={modalView.list.count} cap={modalView.list.items.length} label="machines not shown — open Yard Stock for the full list" />
              </>
            )}
          </div>
        )}

        {modalView?.type === 'dispatch' && (
          modalView.list.count === 0 ? (
            <p className="text-sm text-slate-500 text-center py-3">No machines</p>
          ) : (
            <>
              <Table maxHeight={380}>
                <TableHeader sticky>
                  <TableHeaderCell>Serial</TableHeaderCell>
                  <TableHeaderCell>Model-Type</TableHeaderCell>
                  <TableHeaderCell>Plan</TableHeaderCell>
                  <TableHeaderCell>Driver</TableHeaderCell>
                  <TableHeaderCell>FG Gate-Out</TableHeaderCell>
                </TableHeader>
                <TableBody>
                  {modalView.list.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-[13px] font-medium text-slate-900">{i.serialNumber}</TableCell>
                      <TableCell className="text-[13px] text-slate-700">{i.modelType}</TableCell>
                      <TableCell className="text-[13px] text-slate-600">{i.planNo}</TableCell>
                      <TableCell className="text-[13px] text-slate-600">{i.driver || '—'}</TableCell>
                      <TableCell className={`text-[13px] ${i.overdue ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                        {i.gateOutAt ? `${formatDateTime(i.gateOutAt)} (${elapsed(i.gateOutAt)})` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <MoreHint total={modalView.list.count} cap={modalView.list.items.length} label="machines not shown — open Dispatch Machine List" />
            </>
          )
        )}

        {modalView?.type === 'slots' && (
          detailLoading ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : modalView.list.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-3">No free slots</p>
          ) : (
            <Table maxHeight={380}>
              <TableHeader sticky>
                <TableHeaderCell>Yard</TableHeaderCell>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {modalView.list.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-[13px] font-medium text-slate-900">{s.yardName}</TableCell>
                    <TableCell className="text-[13px] text-slate-700">{slotLabel(s.row, s.col)}</TableCell>
                    <TableCell><SlotStatusBadge status={s.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
      </Modal>
    </div>
  );
}

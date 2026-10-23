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
import { slotLabel, formatDateTime } from '@/lib/format';
import {
  Truck, MapPin, Package, CheckCircle2, Search, ArrowRight, Map, Bookmark, RefreshCw,
  AlertTriangle, Barcode, Clock, Send, ShieldAlert, Factory, Fence, Shield, ChevronRight
} from 'lucide-react';

type SlotCardType = 'available' | 'reserved' | 'occupied' | 'dispatch';
type ModalView =
  | { type: 'machine'; data: any }
  | { type: 'machines'; list: any[]; title: string }
  | { type: 'slots'; list: any[]; slotType: SlotCardType }
  | null;

// Every capped list uses one of these and always says how much it hid, so a
// short list is never mistaken for the whole picture.
const LIST_CAP = 8;
const MODAL_CAP = 50;

// The dashboard is left open on yard screens, so it re-reads on a timer as well
// as on the realtime events it can hear.
const AUTO_REFRESH_MS = 60_000;

const SLOT_STATUS: Record<SlotCardType, string> = {
  available: 'AVAILABLE',
  reserved: 'RESERVED',
  occupied: 'OCCUPIED',
  dispatch: 'DISPATCH_READY',
};

interface YardSummary {
  id: string;
  name: string;
  totalSlots?: number;
  slotCounts?: Record<string, number>;
}

interface WaitingMachine {
  id: string;
  serialNumber: string;
  model?: string;
  assemblyStage: number;
  parkStatus: string;
  slotWaitingSince?: string | null;
}

interface DashboardProps {
  onNavigate?: (tab: string) => void;
  allowedTabs?: string[];
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// A machine can be in one of two places at once, conceptually: standing in a
// slot, or holding a reservation for a slot it has not reached yet. Only the
// first one is a currentSlot, so a machine waiting for its turn was previously
// shown as unallocated.
function machineLocation(machine: any): string {
  if (machine?.currentSlot) {
    return `${machine.currentSlot.yard.name} (${slotLabel(machine.currentSlot.row, machine.currentSlot.col)})`;
  }
  if (machine?.plannedSlot) {
    return `Reserved ${machine.plannedSlot.yard.name} (${slotLabel(machine.plannedSlot.row, machine.plannedSlot.col)})`;
  }
  return 'Not allocated';
}

function MoreHint({ total, cap, label }: { total: number; cap: number; label: string }) {
  if (total <= cap) return null;
  return (
    <p className="px-2 pt-1.5 text-[11px] font-medium text-slate-500">
      +{total - cap} more {label}
    </p>
  );
}

export default function Dashboard({ onNavigate, allowedTabs }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [machines, setMachines] = useState<any[]>([]);
  const [yards, setYards] = useState<YardSummary[]>([]);
  const [waiting, setWaiting] = useState<WaitingMachine[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[] | null>(null);
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [modalView, setModalView] = useState<ModalView>(null);
  const [machineHistory, setMachineHistory] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const can = (tab: string) => !allowedTabs || allowedTabs.includes(tab);
  const canSeeRequests = can('requests');

  // A refresh triggered by a realtime event or the timer must not blank the page,
  // so only the first load owns the loading spinner.
  const fetchDashboard = useCallback(async (initial: boolean) => {
    if (!initial) setRefreshing(true);
    try {
      const headers = authHeaders();

      const [machinesRes, yardsRes, availabilityRes, requestsRes] = await Promise.all([
        fetch(`${API_URL}/api/machines?withAssemblyCompletion=true`, { headers }),
        fetch(`${API_URL}/api/yards`, { headers }),
        fetch(`${API_URL}/api/yards/availability`, { headers }),
        canSeeRequests
          ? fetch(`${API_URL}/api/exit-requests?status=PENDING`, { headers })
          : Promise.resolve(null),
      ]);
      if (!machinesRes.ok) throw new Error(`GET /api/machines -> ${machinesRes.status}`);
      if (!yardsRes.ok) throw new Error(`GET /api/yards -> ${yardsRes.status}`);

      const [allMachines, yardList] = await Promise.all([machinesRes.json(), yardsRes.json()]);
      if (!Array.isArray(allMachines)) throw new Error('GET /api/machines did not return a list');
      if (!Array.isArray(yardList)) throw new Error('GET /api/yards did not return a list');

      // The yard list already carries per-status slot counts, so the tiles no
      // longer need one request per yard.
      setMachines(allMachines);
      setYards(yardList);

      // Secondary panels degrade on their own rather than failing the page.
      if (availabilityRes.ok) {
        const availability = await availabilityRes.json();
        setWaiting(Array.isArray(availability?.waiting) ? availability.waiting : []);
      }
      if (requestsRes && requestsRes.ok) {
        const list = await requestsRes.json();
        setPendingRequests(Array.isArray(list) ? list : []);
      }

      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setError('Could not load yard data. Check that the backend is running, then retry.');
    } finally {
      if (initial) setLoading(false);
      setRefreshing(false);
    }
  }, [API_URL, canSeeRequests]);

  useEffect(() => {
    fetchDashboard(true);
    const timer = setInterval(() => fetchDashboard(false), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  // security-queue and exit-request only reach some roles; notification reaches
  // everyone an alert is addressed to. The timer covers whatever none of them do.
  useRealtimeEvent('security-queue', () => { fetchDashboard(false); });
  useRealtimeEvent('exit-request', () => { fetchDashboard(false); });
  useRealtimeEvent('notification', () => { fetchDashboard(false); });

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    const needle = query.toLowerCase();
    setSearchResults(
      machines.filter((m: any) =>
        m.serialNumber?.toLowerCase().includes(needle) ||
        m.model?.toLowerCase().includes(needle) ||
        m.barcode?.toLowerCase().includes(needle) ||
        m.orderNo?.toLowerCase().includes(needle)
      )
    );
  };

  const handleViewDetails = async (machine: any) => {
    setModalView({ type: 'machine', data: machine });
    setMachineHistory([]);
    try {
      const res = await fetch(`${API_URL}/api/machines/${machine.id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`GET /api/machines/${machine.id} -> ${res.status}`);
      const data = await res.json();
      setMachineHistory(data.movements || []);
    } catch (err) {
      console.error('Failed to load machine detail:', err);
      setMachineHistory([]);
    }
  };

  const openMachines = (title: string, list: any[]) => setModalView({ type: 'machines', list, title });

  const handleSlotCardClick = async (type: SlotCardType) => {
    setDetailLoading(true);
    setModalView({ type: 'slots', list: [], slotType: type });
    try {
      const headers = authHeaders();
      const details = await Promise.all(
        yards.map(async (yard) => {
          const res = await fetch(`${API_URL}/api/yards/${yard.id}`, { headers });
          if (!res.ok) throw new Error(`GET /api/yards/${yard.id} -> ${res.status}`);
          return { yard, data: await res.json() };
        })
      );

      const wanted = SLOT_STATUS[type];
      const matched = details.flatMap(({ yard, data }) =>
        (data.slots || [])
          .filter((s: any) => s.status === wanted)
          .map((s: any) => ({ ...s, yardName: yard.name }))
      );
      setModalView({ type: 'slots', list: matched, slotType: type });
    } catch (err) {
      console.error('Failed to load slots:', err);
      setModalView({ type: 'slots', list: [], slotType: type });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => { setModalView(null); setMachineHistory([]); };

  const detailTitles: Record<string, string> = {
    available: 'Available Slots',
    reserved: 'Reserved Slots',
    occupied: 'Occupied Slots',
    dispatch: 'Dispatch Ready Slots',
  };

  // A reserved slot names the machine holding the promise through plannedFor,
  // because the machine is not physically there and has no currentSlot.
  const slotMachine = (slot: any) =>
    slot.machine?.serialNumber || slot.plannedFor?.serialNumber || null;

  const quickActions = [
    { tab: 'yards', label: 'Yard Management', hint: 'View and manage yard slots', icon: <Map className="w-3.5 h-3.5 text-blue-600" />, iconWrap: 'bg-blue-100 group-hover:bg-blue-200', hover: 'hover:bg-blue-50 hover:border-blue-200', arrow: 'group-hover:text-blue-600' },
    { tab: 'assembly', label: 'Assembly Line', hint: 'Stages 1–18 and completed machines', icon: <Factory className="w-3.5 h-3.5 text-indigo-600" />, iconWrap: 'bg-indigo-100 group-hover:bg-indigo-200', hover: 'hover:bg-indigo-50 hover:border-indigo-200', arrow: 'group-hover:text-indigo-600' },
    { tab: 'gate', label: 'Gate Control', hint: 'Check machines in and out', icon: <Fence className="w-3.5 h-3.5 text-slate-600" />, iconWrap: 'bg-slate-100 group-hover:bg-slate-200', hover: 'hover:bg-slate-50 hover:border-slate-300', arrow: 'group-hover:text-slate-700' },
    { tab: 'machines', label: 'Track Machines', hint: 'Locate and manage inventory', icon: <Truck className="w-3.5 h-3.5 text-emerald-600" />, iconWrap: 'bg-emerald-100 group-hover:bg-emerald-200', hover: 'hover:bg-emerald-50 hover:border-emerald-200', arrow: 'group-hover:text-emerald-600' },
    { tab: 'parked', label: 'Confirm Parking', hint: 'Confirm or record a machine parked in its slot', icon: <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />, iconWrap: 'bg-amber-100 group-hover:bg-amber-200', hover: 'hover:bg-amber-50 hover:border-amber-200', arrow: 'group-hover:text-amber-600' },
    { tab: 'security', label: 'Security Verification', hint: 'Approve or reject parked machines', icon: <Shield className="w-3.5 h-3.5 text-red-600" />, iconWrap: 'bg-red-100 group-hover:bg-red-200', hover: 'hover:bg-red-50 hover:border-red-200', arrow: 'group-hover:text-red-600' },
    { tab: 'requests', label: 'Exit Requests', hint: 'Request or approve machines leaving', icon: <Send className="w-3.5 h-3.5 text-sky-600" />, iconWrap: 'bg-sky-100 group-hover:bg-sky-200', hover: 'hover:bg-sky-50 hover:border-sky-200', arrow: 'group-hover:text-sky-600' },
  ].filter((action) => can(action.tab)).slice(0, 5);

  if (loading) return <PageSpinner />;

  // Slot totals, summed from the per-yard counts.
  const slotTotal = (status: string) => yards.reduce((sum, y) => sum + (y.slotCounts?.[status] ?? 0), 0);
  const totalSlots = yards.reduce((sum, y) => sum + (y.totalSlots ?? 0), 0);
  const stats = {
    availableSlots: slotTotal('AVAILABLE'),
    reservedSlots: slotTotal('RESERVED'),
    occupiedSlots: slotTotal('OCCUPIED'),
    dispatchReady: slotTotal('DISPATCH_READY'),
  };

  // Lifecycle buckets. "Completed" follows the Assembly Line: stage 18 done, so a
  // machine still working through stage 18 is in assembly, not finished.
  const inAssembly = machines.filter((m: any) => m.assemblyStage > 0 && !m.assemblyCompleted);
  const noBarcode = machines.filter((m: any) => m.assemblyCompleted && m.parkStatus === 'PLANNED');
  const readyToMove = machines.filter((m: any) => m.parkStatus === 'READY_TO_MOVE');
  const inTransit = machines.filter((m: any) => m.parkStatus === 'IN_TRANSIT' || m.parkStatus === 'AT_GATE');
  const awaitingVerify = machines.filter(
    (m: any) => m.parkStatus === 'PARKED_PENDING' || m.parkStatus === 'PARKED_REJECTED'
  );
  const rejectedParking = machines.filter((m: any) => m.parkStatus === 'PARKED_REJECTED');
  const parked = machines.filter((m: any) => m.parkStatus === 'PARKED_VERIFIED');
  const exited = machines.filter((m: any) => m.parkStatus === 'EXITED');
  const completedCount = machines.filter((m: any) => m.assemblyCompleted).length;

  // Waiting machines come from the availability endpoint without slot data; map
  // them back to full rows so the modal can show model and location.
  const machineById = new globalThis.Map(machines.map((m: any) => [m.id, m]));
  const waitingMachines = waiting.map((w) => machineById.get(w.id) ?? w);

  const flow = [
    { key: 'assembly', label: 'In Assembly', list: inAssembly, tone: 'border-indigo-200 bg-indigo-50 text-indigo-800' },
    { key: 'barcode', label: 'No Barcode', list: noBarcode, tone: 'border-red-200 bg-red-50 text-red-800' },
    { key: 'ready', label: 'Ready to Move', list: readyToMove, tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
    { key: 'transit', label: 'In Transit / Gate', list: inTransit, tone: 'border-blue-200 bg-blue-50 text-blue-800' },
    { key: 'verify', label: 'Awaiting Verify', list: awaitingVerify, tone: 'border-amber-200 bg-amber-50 text-amber-800' },
    { key: 'parked', label: 'Parked', list: parked, tone: 'border-teal-200 bg-teal-50 text-teal-800' },
    { key: 'exited', label: 'Exited', list: exited, tone: 'border-slate-200 bg-slate-50 text-slate-700' },
  ];

  // Only problems that need a person to act. Each one opens its list, and the
  // button jumps to the screen where it is fixed when this role can reach it.
  const attention = [
    noBarcode.length > 0 && {
      key: 'barcode', count: noBarcode.length, icon: <Barcode className="w-4 h-4" />,
      title: 'Completed without barcode',
      hint: 'Finished stage 18 but cannot be released to the yard',
      tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'bg-red-600',
      onOpen: () => openMachines('Completed without barcode', noBarcode), tab: 'assembly',
    },
    waitingMachines.length > 0 && {
      key: 'waiting', count: waitingMachines.length, icon: <Clock className="w-4 h-4" />,
      title: 'Awaiting gate slot',
      hint: 'Stage 18+ with no slot assigned at gate yet',
      tone: 'border-orange-200 bg-orange-50 text-orange-800', iconTone: 'bg-orange-600',
      onOpen: () => openMachines('Waiting for a slot', waitingMachines), tab: 'yards',
    },
    stats.availableSlots === 0 && yards.length > 0 && {
      key: 'full', count: 0, icon: <AlertTriangle className="w-4 h-4" />,
      title: 'All yards are full',
      hint: 'No slot is available for the next machine',
      tone: 'border-red-200 bg-red-50 text-red-800', iconTone: 'bg-red-600',
      onOpen: () => onNavigate?.('yards'), tab: 'yards',
    },
    rejectedParking.length > 0 && {
      key: 'rejected', count: rejectedParking.length, icon: <ShieldAlert className="w-4 h-4" />,
      title: 'Parking rejected',
      hint: 'Must be re-parked and confirmed again',
      tone: 'border-amber-200 bg-amber-50 text-amber-800', iconTone: 'bg-amber-600',
      onOpen: () => openMachines('Parking rejected', rejectedParking), tab: 'parked',
    },
    pendingRequests && pendingRequests.length > 0 && {
      key: 'requests', count: pendingRequests.length, icon: <Send className="w-4 h-4" />,
      title: 'Exit requests pending',
      hint: 'Waiting for a yard manager decision',
      tone: 'border-sky-200 bg-sky-50 text-sky-800', iconTone: 'bg-sky-600',
      onOpen: () => onNavigate?.('requests'), tab: 'requests',
    },
  ].filter(Boolean) as {
    key: string; count: number; icon: React.ReactNode; title: string; hint: string;
    tone: string; iconTone: string; onOpen: () => void; tab: string;
  }[];

  const listCard = (
    items: any[],
    dot: string,
    wrapper: string,
    empty: string,
    renderSub: (m: any) => string,
    renderBadge: (m: any) => React.ReactNode = (m) => <ParkStatusBadge status={m.parkStatus} />
  ) => (
    <>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-3">{empty}</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {items.slice(0, LIST_CAP).map((m: any) => (
              <div key={m.id} className={`flex items-center justify-between gap-2 p-2 rounded-md ${wrapper}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                    <p className="text-xs text-slate-500 truncate">{renderSub(m)}</p>
                  </div>
                </div>
                <div className="shrink-0">{renderBadge(m)}</div>
              </div>
            ))}
          </div>
          <MoreHint total={items.length} cap={LIST_CAP} label="machines not shown" />
        </>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome back, ${user?.name || 'User'}`}
        description="Here's what's happening in your yard today."
        actions={
          <>
            <p className="text-xs text-slate-500 hidden sm:block tabular-nums">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            <button
              onClick={() => fetchDashboard(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              title="Refresh now (also refreshes every minute)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Refresh'}
            </button>
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800 flex-1">{error}</p>
          <button
            onClick={() => fetchDashboard(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-900 hover:underline"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label="Total Machines" value={machines.length} icon={<Truck className="w-4 h-4" />} color="blue" hint={`${inAssembly.length} in assembly · ${completedCount} completed`} onClick={() => openMachines('All Machines', machines)} />
        <StatCard label="Available Slots" value={stats.availableSlots} icon={<MapPin className="w-4 h-4" />} color={stats.availableSlots === 0 ? 'red' : 'green'} hint={`of ${totalSlots} in ${yards.length} yard${yards.length === 1 ? '' : 's'}`} onClick={() => handleSlotCardClick('available')} />
        <StatCard label="Reserved" value={stats.reservedSlots} icon={<Bookmark className="w-4 h-4" />} color="amber" hint="Held for incoming machines" onClick={() => handleSlotCardClick('reserved')} />
        <StatCard label="Occupied" value={stats.occupiedSlots} icon={<Package className="w-4 h-4" />} color="red" hint="Machine in the slot" onClick={() => handleSlotCardClick('occupied')} />
        <StatCard label="Ready to Move" value={readyToMove.length} icon={<CheckCircle2 className="w-4 h-4" />} color="indigo" hint="Waiting at the plant" onClick={() => openMachines('Ready to Move', readyToMove)} />
        <StatCard label="Waiting for Slot" value={waitingMachines.length} icon={<Clock className="w-4 h-4" />} color={waitingMachines.length > 0 ? 'red' : 'slate'} hint="Stage 13+, no slot yet" onClick={() => openMachines('Waiting for a slot', waitingMachines)} />
      </div>

      {/* Needs attention */}
      {attention.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-medium text-emerald-800">Nothing needs attention right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {attention.map((a) => (
            <div key={a.key} className={`rounded-lg border p-3 ${a.tone}`}>
              <button type="button" onClick={a.onOpen} className="flex w-full items-start gap-2.5 text-left">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white ${a.iconTone}`}>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    {a.count > 0 && <span className="text-lg font-bold tabular-nums leading-none">{a.count}</span>}
                    <span className="text-[13px] font-semibold">{a.title}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] opacity-80">{a.hint}</span>
                </span>
              </button>
              {can(a.tab) && onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate(a.tab)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                >
                  Open {a.tab === 'assembly' ? 'Assembly Line' : a.tab === 'yards' ? 'Yard Management' : a.tab === 'parked' ? 'Confirm Parking' : 'Exit Requests'}
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Machine flow: one count per lifecycle step, left to right */}
      <SectionCard title="Machine Flow" description="Where every machine is in its journey from assembly to the yard">
        <div className="flex flex-wrap items-stretch gap-1.5">
          {flow.map((step, index) => (
            <div key={step.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openMachines(step.label, step.list)}
                className={`min-w-[96px] rounded-lg border px-3 py-2 text-left transition-shadow hover:shadow-sm ${step.tone} ${step.list.length === 0 ? 'opacity-60' : ''}`}
              >
                <p className="text-lg font-bold tabular-nums leading-tight">{step.list.length}</p>
                <p className="text-[11px] font-medium whitespace-nowrap">{step.label}</p>
              </button>
              {index < flow.length - 1 && <ChevronRight className="hidden sm:block w-4 h-4 text-slate-300 shrink-0" />}
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SectionCard title="Quick Search" description="Find machines by serial number, model, barcode or order number">
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by serial, model, barcode or order no..."
              icon={<Search className="w-4 h-4" />}
            />
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {searchResults.slice(0, LIST_CAP).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-md border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 bg-blue-100 rounded-md flex items-center justify-center shrink-0">
                        <Truck className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {m.model || 'N/A'} — {machineLocation(m)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="hidden sm:inline"><ParkStatusBadge status={m.parkStatus} /></span>
                      <button onClick={() => handleViewDetails(m)} className="text-xs font-medium text-blue-700 hover:text-blue-900 px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors">
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-slate-500 mt-2 text-center">No machines found for &quot;{searchQuery}&quot;</p>
            )}
            <MoreHint total={searchResults.length} cap={LIST_CAP} label="matches not shown — keep typing to narrow" />
          </SectionCard>
        </div>

        {quickActions.length > 0 && (
          <SectionCard title="Quick Actions">
            <div className="space-y-1.5">
              {quickActions.map((action) => (
                <button
                  key={action.tab}
                  onClick={() => onNavigate?.(action.tab)}
                  className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 ${action.hover} transition-colors text-left group`}
                >
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center ${action.iconWrap} transition-colors shrink-0`}>
                    {action.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-900">{action.label}</p>
                    <p className="text-xs text-slate-500">{action.hint}</p>
                  </div>
                  <ArrowRight className={`w-3.5 h-3.5 text-slate-400 ml-auto ${action.arrow} transition-colors shrink-0`} />
                </button>
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* Yard capacity */}
      {yards.length > 0 && (
        <SectionCard
          title="Yard Capacity"
          description={`${stats.availableSlots} of ${totalSlots} slots free across ${yards.length} yard${yards.length === 1 ? '' : 's'}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {yards.map((yard) => {
              const total = yard.totalSlots ?? 0;
              const counts = yard.slotCounts ?? {};
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

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <SectionCard title="Awaiting Verification" description="Parked machines a guard still has to check">
          {listCard(
            awaitingVerify,
            'bg-amber-500',
            'bg-amber-50 border border-amber-200',
            'All clear — nothing awaiting a guard',
            (m) => (m.parkStatus === 'PARKED_REJECTED' ? 'Rejected, waiting to be re-parked' : 'Awaiting verification')
          )}
        </SectionCard>

        <SectionCard title="Ready to Move" description="Released to the yard, waiting at the plant">
          {listCard(
            readyToMove,
            'bg-indigo-500',
            'bg-indigo-50 border border-indigo-200',
            'Nothing released and waiting',
            (m) => machineLocation(m)
          )}
        </SectionCard>

        <SectionCard title="In Transit" description="Checked in at the gate, not yet parked">
          {listCard(
            inTransit,
            'bg-blue-500',
            'bg-blue-50 border border-blue-200',
            'Nothing on the road',
            (m) => (m.driver ? `Driver ${m.driver.name}` : machineLocation(m))
          )}
        </SectionCard>

        <SectionCard title="Assembly Progress" description="Machines still on the line, stages 1–18">
          {listCard(
            [...inAssembly].sort((a: any, b: any) => b.assemblyStage - a.assemblyStage),
            'bg-blue-500',
            'bg-slate-50',
            'No machines in assembly',
            (m) => m.model,
            (m) => <Badge variant="blue" size="sm">Stage {m.assemblyStage}/18</Badge>
          )}
        </SectionCard>
      </div>

      <Modal
        open={!!modalView}
        onClose={closeModal}
        title={
          modalView?.type === 'machine' ? 'Machine Details' :
          modalView?.type === 'machines' ? `${modalView.title} (${modalView.list.length})` :
          modalView?.type === 'slots' ? detailTitles[modalView.slotType] : ''
        }
        subtitle={modalView?.type === 'machine' ? modalView.data.serialNumber : undefined}
        size="lg"
      >
        {modalView?.type === 'machine' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                <Truck className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Serial Number</p>
                <p className="text-base font-bold text-slate-900">{modalView.data.serialNumber}</p>
                <p className="text-xs text-slate-500">Model: {modalView.data.model || 'N/A'}</p>
              </div>
              <div className="ml-auto shrink-0"><ParkStatusBadge status={modalView.data.parkStatus} /></div>
            </div>

            {modalView.data.currentSlot ? (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-semibold text-slate-700 mb-1">Current Location</p>
                <div className="flex gap-5">
                  <div><p className="text-[11px] text-slate-500">Yard</p><p className="text-sm font-medium text-slate-900">{modalView.data.currentSlot.yard.name}</p></div>
                  <div><p className="text-[11px] text-slate-500">Slot</p><p className="text-sm font-medium text-slate-900">{slotLabel(modalView.data.currentSlot.row, modalView.data.currentSlot.col)}</p></div>
                </div>
              </div>
            ) : modalView.data.plannedSlot ? (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xs font-semibold text-slate-700 mb-1">Reserved Slot</p>
                <div className="flex gap-5">
                  <div><p className="text-[11px] text-slate-500">Yard</p><p className="text-sm font-medium text-slate-900">{modalView.data.plannedSlot.yard.name}</p></div>
                  <div><p className="text-[11px] text-slate-500">Slot</p><p className="text-sm font-medium text-slate-900">{slotLabel(modalView.data.plannedSlot.row, modalView.data.plannedSlot.col)}</p></div>
                </div>
                <p className="mt-1.5 text-[11px] text-amber-800">Held for this machine. It has not arrived in the slot yet.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Not allocated to a slot.</p>
            )}

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
        )}

        {modalView?.type === 'machines' && (
          <div className="max-h-[420px] overflow-y-auto space-y-1.5">
            {modalView.list.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-3">No machines found</p>
            ) : (
              <>
                {modalView.list.slice(0, MODAL_CAP).map((m: any) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => handleViewDetails(m)}
                    className="w-full flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-md border border-slate-200 text-left hover:bg-blue-50 hover:border-blue-200 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 bg-blue-100 rounded-md flex items-center justify-center shrink-0">
                        <Truck className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {m.model || 'N/A'} — {machineLocation(m)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {m.parkStatus && <ParkStatusBadge status={m.parkStatus} />}
                      {m.assemblyStage > 0 && !m.assemblyCompleted && <Badge variant="blue" size="sm">Stage {m.assemblyStage}</Badge>}
                    </div>
                  </button>
                ))}
                <MoreHint total={modalView.list.length} cap={MODAL_CAP} label="machines not shown" />
              </>
            )}
          </div>
        )}

        {modalView?.type === 'slots' && (
          detailLoading ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div>
              {modalView.list.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-3">No slots found</p>
              ) : (
                <Table maxHeight={380}>
                  <TableHeader sticky>
                    <TableHeaderCell>Yard</TableHeaderCell>
                    <TableHeaderCell>Slot</TableHeaderCell>
                    <TableHeaderCell>{modalView.slotType === 'reserved' ? 'Reserved For' : 'Machine'}</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableHeader>
                  <TableBody>
                    {modalView.list.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-[13px] font-medium text-slate-900">{s.yardName}</TableCell>
                        <TableCell className="text-[13px] text-slate-700">{slotLabel(s.row, s.col)}</TableCell>
                        <TableCell className="text-[13px] text-slate-600">{slotMachine(s) || '—'}</TableCell>
                        <TableCell><SlotStatusBadge status={s.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )
        )}
      </Modal>
    </div>
  );
}

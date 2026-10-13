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
  Truck, MapPin, Package, CheckCircle2, Search, ArrowRight, Map, Bookmark, RefreshCw
} from 'lucide-react';

type SlotCardType = 'available' | 'reserved' | 'occupied' | 'dispatch';
type ModalView =
  | { type: 'machine'; data: any }
  | { type: 'machines'; list: any[] }
  | { type: 'slots'; list: any[]; slotType: SlotCardType }
  | null;

// Every capped list uses one of these and always says how much it hid, so a
// short list is never mistaken for the whole picture.
const LIST_CAP = 8;
const MODAL_CAP = 50;

const SLOT_STATUS: Record<SlotCardType, string> = {
  available: 'AVAILABLE',
  reserved: 'RESERVED',
  occupied: 'OCCUPIED',
  dispatch: 'DISPATCH_READY',
};

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

function hasLocation(machine: any): boolean {
  return Boolean(machine?.currentSlot || machine?.plannedSlot);
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
  const [stats, setStats] = useState({
    totalMachines: 0, availableSlots: 0, reservedSlots: 0,
    occupiedSlots: 0, dispatchReady: 0, totalYards: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machines, setMachines] = useState<any[]>([]);
  const { user } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [modalView, setModalView] = useState<ModalView>(null);
  const [machineHistory, setMachineHistory] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // A refresh triggered by a realtime event must not blank the page, so only
  // the first load owns the loading spinner.
  const fetchDashboard = useCallback(async (initial: boolean) => {
    try {
      const headers = authHeaders();

      const [machinesRes, yardsRes] = await Promise.all([
        fetch(`${API_URL}/api/machines`, { headers }),
        fetch(`${API_URL}/api/yards`, { headers }),
      ]);
      if (!machinesRes.ok) throw new Error(`GET /api/machines -> ${machinesRes.status}`);
      if (!yardsRes.ok) throw new Error(`GET /api/yards -> ${yardsRes.status}`);

      const [allMachines, yards] = await Promise.all([machinesRes.json(), yardsRes.json()]);
      if (!Array.isArray(allMachines)) throw new Error('GET /api/machines did not return a list');
      if (!Array.isArray(yards)) throw new Error('GET /api/yards did not return a list');

      const details = await Promise.all(
        yards.map(async (yard: any) => {
          const res = await fetch(`${API_URL}/api/yards/${yard.id}`, { headers });
          if (!res.ok) throw new Error(`GET /api/yards/${yard.id} -> ${res.status}`);
          return res.json();
        })
      );

      const counts = { availableSlots: 0, reservedSlots: 0, occupiedSlots: 0, dispatchReady: 0 };
      for (const detail of details) {
        for (const slot of detail.slots || []) {
          if (slot.status === 'AVAILABLE') counts.availableSlots++;
          else if (slot.status === 'RESERVED') counts.reservedSlots++;
          else if (slot.status === 'OCCUPIED') counts.occupiedSlots++;
          else if (slot.status === 'DISPATCH_READY') counts.dispatchReady++;
        }
      }

      setMachines(allMachines);
      setStats({ totalMachines: allMachines.length, ...counts, totalYards: yards.length });
      setError(null);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      setError('Could not load yard data. Check that the backend is running, then retry.');
    } finally {
      if (initial) setLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchDashboard(true);
  }, [fetchDashboard]);

  // Two events cover the dashboard: a machine entering the security queue when
  // it parks, and any alert addressed to this user.
  useRealtimeEvent('security-queue', () => { fetchDashboard(false); });
  useRealtimeEvent('notification', () => { fetchDashboard(false); });

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    const needle = query.toLowerCase();
    setSearchResults(
      machines.filter((m: any) =>
        m.serialNumber?.toLowerCase().includes(needle) ||
        m.model?.toLowerCase().includes(needle)
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

  const handleCardClick = async (type: 'machines' | SlotCardType) => {
    if (type === 'machines') {
      setModalView({ type: 'machines', list: machines });
      return;
    }
    setDetailLoading(true);
    setModalView({ type: 'slots', list: [], slotType: type });
    try {
      const headers = authHeaders();
      const yardsRes = await fetch(`${API_URL}/api/yards`, { headers });
      if (!yardsRes.ok) throw new Error(`GET /api/yards -> ${yardsRes.status}`);
      const yards = await yardsRes.json();
      if (!Array.isArray(yards)) throw new Error('GET /api/yards did not return a list');

      const details = await Promise.all(
        yards.map(async (yard: any) => {
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
    machines: 'All Machines',
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
    { tab: 'machines', label: 'Track Machines', hint: 'Locate and manage inventory', icon: <Truck className="w-3.5 h-3.5 text-emerald-600" />, iconWrap: 'bg-emerald-100 group-hover:bg-emerald-200', hover: 'hover:bg-emerald-50 hover:border-emerald-200', arrow: 'group-hover:text-emerald-600' },
    { tab: 'parked', label: 'Confirm Parking', hint: 'Confirm or record a machine parked in its slot', icon: <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />, iconWrap: 'bg-amber-100 group-hover:bg-amber-200', hover: 'hover:bg-amber-50 hover:border-amber-200', arrow: 'group-hover:text-amber-600' },
  ].filter((action) => !allowedTabs || allowedTabs.includes(action.tab));

  if (loading) return <PageSpinner />;

  const assemblyMachines = machines.filter((m: any) => m.assemblyStage > 0 && m.assemblyStage < 18);
  const awaitingVerify = machines.filter(
    (m: any) => m.parkStatus === 'PARKED_PENDING' || m.parkStatus === 'PARKED_REJECTED'
  );
  const readyToMove = machines.filter((m: any) => m.parkStatus === 'READY_TO_MOVE');
  const inTransit = machines.filter((m: any) => m.parkStatus === 'IN_TRANSIT' || m.parkStatus === 'AT_GATE');

  const listCard = (
    items: any[],
    dot: string,
    wrapper: string,
    empty: string,
    renderSub: (m: any) => string
  ) => (
    <>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-3">{empty}</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {items.slice(0, LIST_CAP).map((m: any) => (
              <div key={m.id} className={`flex items-center justify-between p-2 rounded-md ${wrapper}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 truncate">{m.serialNumber}</p>
                    <p className="text-xs text-slate-500 truncate">{renderSub(m)}</p>
                  </div>
                </div>
                {m.parkStatus
                  ? <ParkStatusBadge status={m.parkStatus} />
                  : <Badge variant="blue" size="sm">Stage {m.assemblyStage}/18</Badge>}
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
        actions={<p className="text-xs text-slate-500 hidden sm:block tabular-nums">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>}
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
        <StatCard label="Total Machines" value={stats.totalMachines} icon={<Truck className="w-4 h-4" />} color="blue" onClick={() => handleCardClick('machines')} />
        <StatCard label="Available Slots" value={stats.availableSlots} icon={<MapPin className="w-4 h-4" />} color="green" onClick={() => handleCardClick('available')} />
        <StatCard label="Reserved" value={stats.reservedSlots} icon={<Bookmark className="w-4 h-4" />} color="amber" onClick={() => handleCardClick('reserved')} />
        <StatCard label="Occupied" value={stats.occupiedSlots} icon={<Package className="w-4 h-4" />} color="red" onClick={() => handleCardClick('occupied')} />
        <StatCard label="Dispatch Ready" value={stats.dispatchReady} icon={<CheckCircle2 className="w-4 h-4" />} color="indigo" onClick={() => handleCardClick('dispatch')} />
        <StatCard label="Yards" value={stats.totalYards} icon={<Map className="w-4 h-4" />} color="slate" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SectionCard title="Quick Search" description="Find machines by serial number or model">
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by serial number or model..."
              icon={<Search className="w-4 h-4" />}
            />
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {searchResults.slice(0, LIST_CAP).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-md border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition-colors">
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
                    {hasLocation(m) && (
                      <button onClick={() => handleViewDetails(m)} className="text-xs font-medium text-blue-700 hover:text-blue-900 px-1.5 py-0.5 rounded hover:bg-blue-100 transition-colors shrink-0">
                        View
                      </button>
                    )}
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

        <SectionCard title="Ready to Move" description="Released to the yard, waiting at the gate">
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

        <SectionCard title="Assembly Progress" description="Machines currently in assembly">
          {listCard(
            assemblyMachines,
            'bg-blue-500',
            'bg-slate-50',
            'No machines in assembly',
            (m) => m.model
          )}
        </SectionCard>
      </div>

      <Modal
        open={!!modalView}
        onClose={closeModal}
        title={
          modalView?.type === 'machine' ? 'Machine Details' :
          modalView?.type === 'machines' ? 'All Machines' :
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
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wide">Serial Number</p>
                <p className="text-base font-bold text-slate-900">{modalView.data.serialNumber}</p>
                <p className="text-xs text-slate-500">Model: {modalView.data.model || 'N/A'}</p>
              </div>
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
            ) : null}

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
                  <div key={m.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-md border border-slate-200">
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
                      <ParkStatusBadge status={m.parkStatus} />
                      {m.assemblyStage > 0 && m.assemblyStage < 18 && <Badge variant="blue" size="sm">Stage {m.assemblyStage}</Badge>}
                    </div>
                  </div>
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

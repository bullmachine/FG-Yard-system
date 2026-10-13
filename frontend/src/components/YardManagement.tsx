'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import { AssemblyStageBadge, MachineStatusBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import MachineHistoryModal, { Movement } from '@/components/MachineHistoryModal';
import DriverDetailsModal, { DriverDetails } from '@/components/DriverDetailsModal';
import { slotLabel, formatDateShort, formatDateTime } from '@/lib/format';
import { EXIT_REASON_OPTIONS } from '@/lib/exitReasons';
import { asset } from '@/lib/basePath';
import { Search, Plus, MapPin, Grid3X3, ExternalLink, Pencil } from 'lucide-react';

interface Yard { id: string; name: string; description?: string; rows: number; cols: number; latitude?: number; longitude?: number; address?: string; slotCounts?: Record<string, number>; totalSlots?: number; }
interface Slot { id: string; row: number; col: number; status: string; machine?: any; plannedFor?: any; reservedAt?: string | null; _count?: { movementsFrom: number; movementsTo: number; securityVerifications: number }; movementsTo?: { timestamp: string; reason: string; user?: { name: string } }[]; }

interface DispatchMachine { id: string; serialNumber: string; model?: string | null; }

interface AvailabilityYard {
  yardId: string;
  yardName: string;
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  other: number;
}

interface WaitingMachine { id: string; serialNumber: string; model: string; assemblyStage: number; parkStatus: string; slotWaitingSince: string | null; }

interface AvailabilitySummary {
  availability: AvailabilityYard[];
  totalAvailable: number;
  waiting: WaitingMachine[];
}

const SLOT_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  AVAILABLE: { bg: 'bg-emerald-100', border: 'border-emerald-400', text: 'text-emerald-800', label: 'Available' },
  OCCUPIED: { bg: 'bg-red-100', border: 'border-red-400', text: 'text-red-800', label: 'Occupied' },
  DISPATCH_READY: { bg: 'bg-blue-100', border: 'border-blue-400', text: 'text-blue-800', label: 'Dispatch Ready' },
  INSPECTION: { bg: 'bg-amber-100', border: 'border-amber-400', text: 'text-amber-800', label: 'Inspection' },
  BLOCKED: { bg: 'bg-slate-200', border: 'border-slate-400', text: 'text-slate-700', label: 'Blocked' },
  RESERVED: { bg: 'bg-yellow-100', border: 'border-yellow-400', text: 'text-yellow-800', label: 'Reserved' },
  MAINTENANCE: { bg: 'bg-orange-100', border: 'border-orange-400', text: 'text-orange-800', label: 'Maintenance' },
};

function heldForLabel(reservedAt?: string | null): string {
  if (!reservedAt) return '';
  const ms = Date.now() - new Date(reservedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// How long the machine has stood in its slot, from the movement that parked it here.
function agingLabel(parkedAt?: string | null): string {
  if (!parkedAt) return '';
  const ms = Date.now() - new Date(parkedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'less than a day';
  const days = Math.floor(ms / 86_400_000);
  return days === 0 ? 'less than a day' : `${days} ${days === 1 ? 'day' : 'days'}`;
}

// Mirrors MAX_YARD_DIMENSION / MAX_YARD_SLOTS in backend/src/controllers/yardController.ts.
// Kept as literals because the frontend cannot import backend code; the server still
// enforces both, this only stops an obviously invalid value reaching it.
const MAX_DIMENSION = 100;

/**
 * Parse a dimension typed into a number field.
 *
 * An empty or cleared box returns the fallback instead of the old `parseInt(x) || 10`,
 * which made clearing the field silently jump the yard to 10x10.
 */
function parseDimensionInput(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_DIMENSION);
}

export default function YardManagement() {
  const [yards, setYards] = useState<Yard[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editing, setEditing] = useState<Yard | null>(null);
  const [selectedYard, setSelectedYard] = useState<Yard | null>(null);
  const [selectedYardSlots, setSelectedYardSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [yardFormError, setYardFormError] = useState<string | null>(null);
  const [yardNotice, setYardNotice] = useState<string | null>(null);
  // Rows/cols/lat/lng are held as strings so a cleared box stays empty instead of
  // snapping back to a default the moment the field loses focus.
  const [yardForm, setYardForm] = useState({ name: '', description: '', rows: '10', cols: '10', latitude: '', longitude: '', address: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedSlot, setHighlightedSlot] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [draggedSlot, setDraggedSlot] = useState<Slot | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySummary | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Slot | null>(null);
  const [removeReason, setRemoveReason] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<DispatchMachine | null>(null);
  const [dispatchReason, setDispatchReason] = useState('DISPATCH');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  // Machine history is opened by id from the slot panel. Movements are fetched
  // once per machine (and reused) from the machines list endpoint, the same source
  // Machine Tracking passes to the modal; stages load from the modal's own fetch.
  const [historyMachineId, setHistoryMachineId] = useState<string | null>(null);
  const [historySerial, setHistorySerial] = useState<string | undefined>(undefined);
  const historyMovementsRef = useRef<Record<string, Movement[]>>({});
  const [historyMovements, setHistoryMovements] = useState<Movement[] | null>(null);
  // Driver details opened from the slot panel. The slot already carries the full
  // driver row, so it is held here and enriched by the modal with login + count.
  const [driverDetails, setDriverDetails] = useState<{ id: string; driver: DriverDetails } | null>(null);
  const { token, user, isAuthenticated } = useAuth();
  const isViewOnly = !isAuthenticated || user?.role === 'VIEW_ONLY';
  const canRelease = isAuthenticated && (user?.role === 'YARD_MANAGER' || user?.role === 'ADMIN');
  const isAdmin = isAuthenticated && user?.role === 'ADMIN';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const headers = () => { const h: Record<string, string> = {}; if (token) h['Authorization'] = `Bearer ${token}`; return h; };

  const fetchYards = async () => {
    try { const r = await fetch(`${API_URL}/api/yards`, { headers: headers() }); const d = await r.json(); setYards(Array.isArray(d) ? d : []); } catch { setYards([]); } finally { setLoading(false); }
  };

  const fetchAvailability = async () => {
    try { const r = await fetch(`${API_URL}/api/yards/availability`, { headers: headers() }); const d = await r.json(); setAvailability(d ?? null); } catch { setAvailability(null); }
  };

  const fetchYardSlots = async (yardId: string) => {
    try { const r = await fetch(`${API_URL}/api/yards/${yardId}`, { headers: headers() }); const d = await r.json(); setSelectedYardSlots(Array.isArray(d.slots) ? d.slots : []); } catch { setSelectedYardSlots([]); }
  };

  useEffect(() => { fetchYards(); fetchAvailability(); }, []);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setHighlightedSlot(null); return; }
    const found = selectedYardSlots.find(s => s.machine?.serialNumber?.toLowerCase().includes(q.toLowerCase()) || slotLabel(s.row, s.col).toLowerCase().includes(q.toLowerCase()));
    setHighlightedSlot(found?.id || null);
  };

  // Opened from the slot panel when a serial or reserved-for serial is clicked.
  // Movements come from the machines list (cached per machine); stages load inside
  // the modal, so there is no flash of an empty tab before the timeline appears.
  const openHistory = async (machineId: string, serialNumber?: string) => {
    setHistoryMachineId(machineId);
    setHistorySerial(serialNumber);
    const cached = historyMovementsRef.current[machineId];
    if (serialNumber && cached) { setHistoryMovements(cached); return; }
    setHistoryMovements(null);
    try {
      const r = await fetch(`${API_URL}/api/machines`, { headers: headers() });
      const list = await r.json();
      const found = Array.isArray(list) ? list.find((m: { id: string; movements?: Movement[] }) => m.id === machineId) : null;
      const movements = Array.isArray(found?.movements) ? found.movements : null;
      historyMovementsRef.current[machineId] = movements ?? [];
      setHistoryMovements(movements);
    } catch {
      historyMovementsRef.current[machineId] = [];
      setHistoryMovements([]);
    }
  };

  const handleDragStart = (slot: Slot) => { if (slot.machine && !isViewOnly) setDraggedSlot(slot); };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (e: React.DragEvent, target: Slot) => {
    e.preventDefault();
    if (!draggedSlot || draggedSlot.id === target.id || !draggedSlot.machine) { setDraggedSlot(null); return; }
    try { await fetch(`${API_URL}/api/machines/${draggedSlot.machine.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ currentSlotId: target.id }) }); if (selectedYard) await fetchYardSlots(selectedYard.id); } catch { }
    setDraggedSlot(null);
  };

  const openDispatch = (machine: DispatchMachine) => {
    setDispatchTarget(machine);
    setDispatchReason('DISPATCH');
    setDispatchNotes('');
    setDispatchError(null);
  };

  const handleDispatchMachine = async () => {
    if (!dispatchTarget) return;
    setDispatchSubmitting(true);
    setDispatchError(null);
    try {
      const r = await fetch(`${API_URL}/api/machines/${dispatchTarget.id}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ reason: dispatchReason, notes: dispatchNotes })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setDispatchError(d?.error || `Could not release this machine (${r.status})`);
        return;
      }
      if (selectedYard) await fetchYardSlots(selectedYard.id);
      await fetchAvailability();
      setDispatchTarget(null);
      setSelectedSlot(null);
    } catch {
      setDispatchError('Could not reach the server');
    } finally {
      setDispatchSubmitting(false);
    }
  };

  const handleReleaseReservation = async (slot: Slot) => {
    const reason = releaseReason.trim();
    if (reason.length < 5) { alert('Enter a reason of at least 5 characters.'); return; }
    if (slot.plannedFor?.parkStatus === 'READY_TO_MOVE') {
      const ok = confirm(`${slot.plannedFor.serialNumber} is at stage ${slot.plannedFor.assemblyStage} (ready to move) and closest to driving in. Releasing its slot may strand the machine. Continue?`);
      if (!ok) return;
    }
    setReleasing(true);
    try {
      const r = await fetch(`${API_URL}/api/yards/slots/${slot.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ reason })
      });
      const d = await r.json();
      if (!r.ok) { alert(d?.error || 'Unable to release this slot'); return; }
      if (selectedYard) await fetchYardSlots(selectedYard.id);
      await fetchAvailability();
      setSelectedSlot(null);
      setReleaseReason('');
      alert(d.reassignedTo ? `${slot.plannedFor?.serialNumber} released. Slot ${slotLabel(slot.row, slot.col)} re-allocated automatically to ${d.reassignedTo} (longest wait).` : `Reservation released from ${d.releasedMachine}. No machine is waiting.`);
    } catch { alert('Failed to release slot'); } finally { setReleasing(false); }
  };

  const openCreateYard = () => {
    setEditing(null);
    setYardForm({ name: '', description: '', rows: '10', cols: '10', latitude: '', longitude: '', address: '' });
    setYardFormError(null);
    setShowCreateModal(true);
  };

  const openEditYard = (yard: Yard) => {
    setEditing(yard);
    setYardForm({
      name: yard.name,
      description: yard.description || '',
      rows: String(yard.rows),
      cols: String(yard.cols),
      latitude: yard.latitude != null ? String(yard.latitude) : '',
      longitude: yard.longitude != null ? String(yard.longitude) : '',
      address: yard.address || ''
    });
    setYardFormError(null);
    setShowCreateModal(true);
  };

  const handleSaveYard = async () => {
    setSubmitting(true);
    setYardFormError(null);

    const rows = parseDimensionInput(yardForm.rows, editing ? editing.rows : 10);
    const cols = parseDimensionInput(yardForm.cols, editing ? editing.cols : 10);

    if (!yardForm.name.trim()) {
      setYardFormError('Yard name is required');
      setSubmitting(false);
      return;
    }
    // Growing only. Caught here so the user gets a clear message instead of a 400 that
    // mentions removal, which is a different screen.
    if (editing && (rows < editing.rows || cols < editing.cols)) {
      setYardFormError(`${editing.name} is ${editing.rows} x ${editing.cols} and cannot be made smaller. Remove individual slots from the yard view instead.`);
      setSubmitting(false);
      return;
    }

    const coord = (raw: string, field: string, limit: number): string | null => {
      if (raw.trim() === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || Math.abs(n) > limit) {
        throw new Error(`${field} must be a number between -${limit} and ${limit}`);
      }
      return String(n);
    };

    let latitude: string | null;
    let longitude: string | null;
    try {
      latitude = coord(yardForm.latitude, 'Latitude', 90);
      longitude = coord(yardForm.longitude, 'Longitude', 180);
    } catch (e) {
      setYardFormError(e instanceof Error ? e.message : 'Invalid coordinates');
      setSubmitting(false);
      return;
    }

    const payload = {
      name: yardForm.name.trim(),
      description: yardForm.description.trim() || null,
      rows,
      cols,
      latitude,
      longitude,
      address: yardForm.address.trim() || null
    };

    try {
      const r = await fetch(
        editing ? `${API_URL}/api/yards/${editing.id}` : `${API_URL}/api/yards`,
        { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(payload) }
      );
      const body = await r.json().catch(() => null);

      // The old handler only checked r.ok and said nothing on failure, so a rejected
      // save looked exactly like a successful one.
      if (!r.ok) {
        setYardFormError(body?.error || `Save failed (${r.status})`);
        return;
      }

      const created = body?.slotsCreated ?? 0;
      setYardNotice(
        editing
          ? `${editing.name} updated${created > 0 ? ` - ${created} slot${created === 1 ? '' : 's'} added` : ' - no new slots needed'}.`
          : `${payload.name} created with ${rows * cols} slot${rows * cols === 1 ? '' : 's'}.`
      );
      setShowCreateModal(false);
      setEditing(null);
      await fetchYards();
    } catch {
      setYardFormError('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  };

  /** How removing this slot would actually behave, so the dialog can say so up front. */
  const removalPlan = (slot: Slot | null) => {
    if (!slot) return null;
    const history = (slot._count?.movementsFrom ?? 0) + (slot._count?.movementsTo ?? 0) + (slot._count?.securityVerifications ?? 0);
    if (slot.machine) return { kind: 'blocked' as const, title: 'Slot is occupied', detail: `${slot.machine.serialNumber} is parked here. Dispatch or move it before removing the slot.`, history };
    if (slot.plannedFor) return { kind: 'blocked' as const, title: 'Slot is reserved', detail: `${slot.plannedFor.serialNumber} holds this slot as a promise. Release the reservation first.`, history };
    if (history > 0) return { kind: 'block' as const, title: 'Will be marked out of service', detail: `This slot has ${history} movement or verification record${history === 1 ? '' : 's'}. It will be marked Blocked so that history is kept, rather than deleted.`, history };
    return { kind: 'delete' as const, title: 'Will be deleted', detail: 'This slot has no machine, no reservation and no history, so it will be deleted outright.', history };
  };

  const handleRemoveSlot = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const r = await fetch(`${API_URL}/api/yards/slots/${removeTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ reason: removeReason })
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        setRemoveError(body?.error || `Remove failed (${r.status})`);
        return;
      }

      const label = slotLabel(body.row ?? removeTarget.row, body.col ?? removeTarget.col);
      setYardNotice(
        body.outcome === 'DELETED'
          ? `Slot ${label} deleted.`
          : `Slot ${label} marked out of service${body.alreadyBlocked ? ' (already Blocked)' : ''}. ${body.preservedRecords} history record${body.preservedRecords === 1 ? '' : 's'} kept.`
      );
      setRemoveTarget(null);
      setRemoveReason('');
      setSelectedSlot(null);
      if (selectedYard) { await fetchYardSlots(selectedYard.id); await fetchYards(); }
      await fetchAvailability();
    } catch {
      setRemoveError('Could not reach the server');
    } finally {
      setRemoving(false);
    }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(
      (pos) => setYardForm((f) => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) })),
      () => alert('Unable to get location. Enter GPS coordinates manually.')
    );
  };

  if (loading) return <PageSpinner />;

  // Position -> slot, so the grid can render a fixed rows x cols matrix and place an
  // explicit empty cell where a slot has been removed.
  const slotIndex = new Map(selectedYardSlots.map(s => [`${s.row}:${s.col}`, s]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Yard Management"
        description={`${yards.length} yard${yards.length !== 1 ? 's' : ''} configured`}
        actions={!isViewOnly ? <Button icon={<Plus className="w-4 h-4" />} onClick={openCreateYard}>Create Yard</Button> : undefined}
      />

      {yardNotice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-900">{yardNotice}</p>
          <button type="button" onClick={() => setYardNotice(null)} aria-label="Dismiss" className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold leading-none">✕</button>
        </div>
      )}

      {availability && availability.totalAvailable === 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-red-800">No allocatable slots — every yard is fully reserved</p>
              <p className="text-xs text-red-700 mt-1">
                {availability.availability.map(a => `${a.yardName}: ${a.reserved} reserved / ${a.total} total`).join(' · ')}.
                {availability.waiting.length > 0 && ` ${availability.waiting.length} machine${availability.waiting.length !== 1 ? 's' : ''} at stage 13+ are waiting for a slot.`}
              </p>
            </div>
            {canRelease && availability.waiting.length > 0 && (
              <div className="shrink-0">
                <p className="text-[10px] uppercase font-semibold text-red-600 mb-0.5">Waiting longest</p>
                <p className="text-xs font-medium text-red-800">{availability.waiting.slice(0, 3).map(m => m.serialNumber).join(', ')}</p>
                {availability.waiting.length > 3 && <p className="text-[10px] text-red-500">+{availability.waiting.length - 3} more</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {yards.length === 0 ? (
        <EmptyState title="No yards created" description="Create your first yard to start managing slots" action={!isViewOnly ? <Button onClick={openCreateYard}>Create Yard</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {yards.map(yard => (
            <div key={yard.id} onClick={async () => { setSelectedYard(yard); await fetchYardSlots(yard.id); }}
              className="bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] p-4 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group">
              <div className="flex items-start justify-between mb-2.5">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">{yard.name}</h3>
                  {yard.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{yard.description}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                <div className="w-8 h-8 bg-blue-50 rounded-md flex items-center justify-center group-hover:bg-blue-100 transition-colors shrink-0">
                  <MapPin className="w-4 h-4 text-blue-600" />
                </div>
                {/* stopPropagation, otherwise editing opens the yard view instead. */}
                {canRelease && (
                  <button
                    type="button"
                    title={`Edit ${yard.name}`}
                    aria-label={`Edit ${yard.name}`}
                    onClick={(e) => { e.stopPropagation(); openEditYard(yard); }}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-slate-400 hover:text-blue-700 hover:bg-blue-50 transition-colors shrink-0"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Grid3X3 className="w-3.5 h-3.5" /> {yard.rows} × {yard.cols}</span>
                {/* Real slot count, not rows*cols. Removed slots leave a hole while the
                    grid keeps its dimensions, so rows*cols would overstate capacity. */}
                <span className="tabular-nums">{yard.totalSlots ?? yard.rows * yard.cols} total slots</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <span className={`text-xs font-semibold tabular-nums ${(yard.slotCounts?.AVAILABLE ?? 0) === 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {(yard.slotCounts?.AVAILABLE ?? 0)} free
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full ${(yard.slotCounts?.AVAILABLE ?? 0) === 0 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${(yard.totalSlots ?? 0) === 0 ? 0 : (((yard.slotCounts?.AVAILABLE ?? 0) / (yard.totalSlots ?? 1)) * 100)}%` }} />
                </div>
                {(yard.slotCounts?.AVAILABLE ?? 0) === 0 && <Badge variant="red" dot>Full</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Yard View Modal */}
      <Modal open={!!selectedYard} onClose={() => { setSelectedYard(null); setSelectedYardSlots([]); setSelectedSlot(null); setReleaseReason(''); }} title={selectedYard?.name} subtitle={selectedYard?.description} size="xl">
        {selectedYard && (
          <div className="flex flex-col lg:flex-row gap-5">
            <div className="flex-1 min-w-0">
              {(selectedYard.latitude || selectedYard.address) && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      {selectedYard.address && <p className="text-xs font-medium text-blue-800">{selectedYard.address}</p>}
                      {selectedYard.latitude && <p className="text-xs text-blue-600">{selectedYard.latitude.toFixed(6)}, {selectedYard.longitude?.toFixed(6)}</p>}
                    </div>
                    {selectedYard.latitude && <a href={`https://www.google.com/maps?q=${selectedYard.latitude},${selectedYard.longitude}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Maps</a>}
                  </div>
                </div>
              )}

              <div className="relative mb-3">
                <Input value={searchQuery} onChange={e => handleSearch(e.target.value)} placeholder="Search by vehicle or slot (A1, B2)..." icon={<Search className="w-4 h-4" />} />
                {highlightedSlot && <p className="text-xs text-emerald-600 mt-1 font-medium">Found — highlighted in grid</p>}
              </div>

              <div className="space-y-1.5 p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-1.5 ml-[22px] mb-1">
                  {Array.from({ length: selectedYard.cols }, (_, i) => <span key={i} className="flex-1 text-center text-[9px] font-bold text-slate-500">{i + 1}</span>)}
                </div>
                {Array.from({ length: selectedYard.rows }, (_, ri) => (
                  <div key={ri} className="grid gap-1.5" style={{ gridTemplateColumns: `22px repeat(${selectedYard.cols}, minmax(0, 1fr))` }}>
                    <div className="aspect-square flex items-center justify-center text-[9px] font-bold text-slate-500 bg-slate-200 rounded">{String.fromCharCode(64 + ri + 1)}</div>
                    {/* Every row emits exactly `cols` cells. The old code mapped over the
                        slots that existed, so one removed slot shifted every slot after it
                        leftwards and the header stopped lining up with the grid. */}
                    {Array.from({ length: selectedYard.cols }, (_, ci) => {
                      const slot = slotIndex.get(`${ri + 1}:${ci + 1}`);
                      if (!slot) {
                        return (
                          <div key={`empty-${ri + 1}-${ci + 1}`} title={`${slotLabel(ri + 1, ci + 1)} - removed`}
                            aria-label={`${slotLabel(ri + 1, ci + 1)} removed`}
                            className="aspect-square border border-dashed border-slate-300 rounded-md flex items-center justify-center text-[10px] font-bold text-slate-400">
                            {slotLabel(ri + 1, ci + 1)}
                          </div>
                        );
                      }
                      const c = SLOT_COLORS[slot.status] || SLOT_COLORS.AVAILABLE;
                      return (
                        <div key={slot.id} draggable={!!slot.machine && !isViewOnly} onDragStart={() => handleDragStart(slot)} onDragOver={handleDragOver} onDrop={e => handleDrop(e, slot)} onClick={() => { setSelectedSlot(slot); setReleaseReason(''); }}
                          className={`relative aspect-square border rounded-md flex flex-col items-center justify-center text-[10px] font-bold transition-all ${c.bg} ${c.border} ${c.text} ${highlightedSlot === slot.id ? 'ring-2 ring-yellow-400 scale-110 shadow-md z-10' : ''} ${slot.machine && !isViewOnly ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${draggedSlot?.id === slot.id ? 'opacity-40' : ''} ${selectedSlot?.id === slot.id ? 'ring-2 ring-blue-500' : ''}`}>
                          {slot.machine && (
                            /* Decorative only: the serial below carries the meaning, and
                               the status colour must stay readable through it. */
                            <img src={asset("/backhoe-loader.webp")} alt="" aria-hidden="true" draggable={false}
                              className="pointer-events-none absolute inset-0 h-full w-full object-contain p-0.5 opacity-30" />
                          )}
                          <span className="relative z-10">{slotLabel(slot.row, slot.col)}</span>
                          {(slot.machine || slot.plannedFor) && <span className="relative z-10 text-[8px] font-medium mt-0.5 truncate max-w-full px-0.5">{slot.machine?.serialNumber || slot.plannedFor?.serialNumber}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-200">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-slate-200">
                  <div className="relative w-4 h-4 rounded-sm bg-red-100 border border-red-400 overflow-hidden">
                    <img src={asset("/backhoe-loader.webp")} alt="" aria-hidden="true" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-30" />
                  </div>
                  <span className="text-[10px] font-medium text-slate-600">Machine present</span>
                </div>
                {Object.entries(SLOT_COLORS).map(([key, c]) => (
                  <div key={key} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-slate-200">
                    <div className={`w-2 h-2 rounded-sm ${c.bg} border ${c.border}`} />
                    <span className="text-[10px] font-medium text-slate-600">{c.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-100 border border-yellow-400 inline-block" /> A yellow (Reserved) slot shows the serial of the machine that holds it, even though it has not arrived yet.</p>
            </div>

            <div className="w-full lg:w-64 shrink-0">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Slot Details</h4>
              {selectedSlot ? (
                <div className="space-y-2.5">
                  <div className="p-3 bg-white rounded-lg border border-slate-200">
                    <p className="text-lg font-bold text-slate-900 tabular-nums">{slotLabel(selectedSlot.row, selectedSlot.col)}</p>
                    <Badge variant={selectedSlot.status === 'AVAILABLE' ? 'green' : selectedSlot.status === 'OCCUPIED' ? 'red' : selectedSlot.status === 'DISPATCH_READY' ? 'blue' : selectedSlot.status === 'INSPECTION' ? 'amber' : selectedSlot.status === 'MAINTENANCE' ? 'orange' : 'gray'} dot>{SLOT_COLORS[selectedSlot.status]?.label || selectedSlot.status}</Badge>
                  </div>
                  {selectedSlot.machine && (
                    <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] text-slate-500 uppercase font-medium">Machine</p>
                        <AssemblyStageBadge stage={selectedSlot.machine.assemblyStage} />
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => openHistory(selectedSlot.machine.id, selectedSlot.machine.serialNumber)}
                          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 leading-tight hover:text-indigo-700 transition-colors"
                        >
                          {selectedSlot.machine.serialNumber}
                          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                        {selectedSlot.machine.model && <p className="text-xs text-slate-500">{selectedSlot.machine.model}</p>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <ParkStatusBadge status={selectedSlot.machine.parkStatus} />
                        {selectedSlot.machine.status !== 'AVAILABLE' && <MachineStatusBadge status={selectedSlot.machine.status} />}
                      </div>
                      <dl className="text-[11px] space-y-1">
                        {selectedSlot.machine.productionDate && (
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">Prod date</dt><dd className="text-slate-800 text-right">{formatDateShort(selectedSlot.machine.productionDate)}</dd></div>
                        )}
                        {selectedSlot.machine.fertCategory && (
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">Category</dt><dd className="text-slate-800 text-right">{selectedSlot.machine.fertCategory}</dd></div>
                        )}
                        {selectedSlot.machine.driver?.id && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="text-slate-500">Driver</dt>
                            <dd className="text-right">
                              <button
                                type="button"
                                onClick={() => setDriverDetails({ id: selectedSlot.machine.driver.id, driver: selectedSlot.machine.driver })}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-800 hover:text-indigo-700 transition-colors"
                              >
                                {selectedSlot.machine.driver.name}
                                <ExternalLink className="h-3 w-3 text-slate-400" />
                              </button>
                            </dd>
                          </div>
                        )}
                        {selectedSlot.movementsTo?.[0]?.timestamp && (
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Parked</dt>
                            <dd className="text-slate-800 text-right">
                              {formatDateTime(selectedSlot.movementsTo[0].timestamp)}
                              {selectedSlot.movementsTo[0].user?.name && <span className="block text-[10px] text-slate-500">by {selectedSlot.movementsTo[0].user.name}</span>}
                            </dd>
                          </div>
                        )}
                        {selectedSlot.movementsTo?.[0]?.timestamp && (
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Aging</dt>
                            <dd className="text-slate-800 font-medium text-right">{agingLabel(selectedSlot.movementsTo[0].timestamp)}</dd>
                          </div>
                        )}
                      </dl>
                      {canRelease && <Button variant="danger" size="sm" className="w-full" onClick={() => openDispatch(selectedSlot.machine)}>Dispatch</Button>}
                    </div>
                  )}
                  {!selectedSlot.machine && selectedSlot.plannedFor && (
                    <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-300">
                      <p className="text-[10px] text-yellow-800 uppercase font-medium mb-1">Reserved for</p>
                      <button
                        type="button"
                        onClick={() => openHistory(selectedSlot.plannedFor.id, selectedSlot.plannedFor.serialNumber)}
                        className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 hover:text-indigo-700 transition-colors"
                      >
                        {selectedSlot.plannedFor.serialNumber}
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                      </button>
                      {selectedSlot.plannedFor.model && <p className="text-xs text-slate-500">{selectedSlot.plannedFor.model}</p>}
                      <p className="text-[11px] text-slate-600 mt-1">Stage {selectedSlot.plannedFor.assemblyStage} · {selectedSlot.plannedFor.parkStatus.replace(/_/g, ' ').toLowerCase()}</p>
                      {selectedSlot.reservedAt && <p className="text-[11px] text-slate-500 mt-0.5">Held {heldForLabel(selectedSlot.reservedAt)} (since {new Date(selectedSlot.reservedAt).toLocaleString()})</p>}
                      {canRelease && (
                        <div className="mt-2.5 space-y-2">
                          <textarea
                            value={releaseReason}
                            onChange={e => setReleaseReason(e.target.value)}
                            placeholder={`Why release ${selectedSlot.plannedFor.serialNumber} from this slot?`}
                            className="w-full px-2.5 py-1.5 text-xs border border-yellow-300 rounded-md focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500 outline-none placeholder:text-slate-400 resize-none bg-white"
                            rows={2}
                          />
                          <Button variant="danger" size="sm" className="w-full" loading={releasing} onClick={() => handleReleaseReservation(selectedSlot)}>Release reservation</Button>
                        </div>
                      )}
                    </div>
                  )}
                  {canRelease && (
                    <div className="p-3 bg-white rounded-lg border border-slate-200">
                      <p className="text-[10px] text-slate-500 uppercase font-medium mb-1.5">Remove slot</p>
                      {/* The dialog says whether this will delete or only block, so the
                          button label stays neutral instead of promising one outcome. */}
                      <Button variant="secondary" size="sm" className="w-full" onClick={() => { setRemoveTarget(selectedSlot); setRemoveReason(''); setRemoveError(null); }}>
                        Remove {slotLabel(selectedSlot.row, selectedSlot.col)}
                      </Button>
                      {(removalPlan(selectedSlot)?.history ?? 0) > 0 && (
                        <p className="text-[11px] text-slate-500 mt-1.5">Has {removalPlan(selectedSlot)?.history} history record{(removalPlan(selectedSlot)?.history ?? 0) === 1 ? '' : 's'}, so it can only be marked out of service.</p>
                      )}
                    </div>
                  )}
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setSelectedSlot(null)}>Clear</Button>
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-6">Click a slot to view details</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Dispatch / exit release modal - manager quick release. Releases the slot,
          marks the machine AT_GATE, stamps an auto-approved exit request and notifies
          Security's Authorized Exits in real time. */}
      <Modal
        open={!!dispatchTarget}
        onClose={() => setDispatchTarget(null)}
        title="Dispatch Machine"
        subtitle={dispatchTarget ? `${dispatchTarget.serialNumber} will be released from its slot, marked AT GATE on the gate screen and shown to Security as an authorized exit.` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDispatchTarget(null)}>Cancel</Button>
            <Button onClick={handleDispatchMachine} loading={dispatchSubmitting} icon={<ExternalLink className="w-4 h-4" />}>
              Release Machine
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {dispatchError && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{dispatchError}</div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] text-slate-500 uppercase font-medium mb-1">Machine</p>
            <p className="text-sm font-bold text-slate-900">{dispatchTarget?.serialNumber}</p>
            {dispatchTarget?.model && <p className="text-xs text-slate-500">{dispatchTarget.model}</p>}
          </div>
          <Select
            label="Exit purpose"
            value={dispatchReason}
            onChange={(e) => setDispatchReason(e.target.value)}
            options={EXIT_REASON_OPTIONS}
          />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">Notes (optional)</label>
            <textarea
              value={dispatchNotes}
              onChange={(e) => setDispatchNotes(e.target.value)}
              rows={2}
              placeholder="e.g. moving to the customer yard for delivery"
              className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none"
            />
          </div>
        </div>
      </Modal>

      {/* Create / Edit Yard Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={editing ? `Edit ${editing.name}` : 'Create New Yard'}
        subtitle={editing ? 'Rows and columns can only be increased. Removing capacity is done per slot from the yard view.' : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleSaveYard} loading={submitting}>{editing ? 'Save Changes' : 'Create Yard'}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {yardFormError && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{yardFormError}</div>
          )}
          <Input label="Yard Name" value={yardForm.name} onChange={e => setYardForm({ ...yardForm, name: e.target.value })} placeholder="e.g., Yard A" />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">Description</label>
            <textarea value={yardForm.description} onChange={e => setYardForm({ ...yardForm, description: e.target.value })} className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none" rows={2} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* min/max mirror the server. parseInt(...) || 10 in the old input made
                clearing the box silently reset the yard to 10 on every keystroke. */}
            <Input label="Rows" type="number" min={1} max={MAX_DIMENSION} value={yardForm.rows} onChange={e => setYardForm({ ...yardForm, rows: e.target.value })} hint={editing ? `currently ${editing.rows}` : undefined} />
            <Input label="Columns" type="number" min={1} max={MAX_DIMENSION} value={yardForm.cols} onChange={e => setYardForm({ ...yardForm, cols: e.target.value })} hint={editing ? `currently ${editing.cols}` : undefined} />
          </div>
          <div className="border-t border-slate-200 pt-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[13px] font-medium text-slate-700">GPS Location</p>
              <button type="button" onClick={getCurrentLocation} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Get Current Location</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Latitude" type="number" step="any" min={-90} max={90} value={yardForm.latitude} onChange={e => setYardForm({ ...yardForm, latitude: e.target.value })} placeholder="40.7128" />
              <Input label="Longitude" type="number" step="any" min={-180} max={180} value={yardForm.longitude} onChange={e => setYardForm({ ...yardForm, longitude: e.target.value })} placeholder="-74.0060" />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">Leave blank for no coordinates.</p>
            <div className="mt-3">
              <Input label="Address" value={yardForm.address} onChange={e => setYardForm({ ...yardForm, address: e.target.value })} placeholder="123 Industrial Ave" />
            </div>
          </div>
        </div>
      </Modal>

      {/* Remove Slot Modal */}
      <Modal
        open={!!removeTarget}
        onClose={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveError(null); }}
        title="Remove Slot"
        subtitle={removeTarget ? `Slot ${slotLabel(removeTarget.row, removeTarget.col)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setRemoveTarget(null); setRemoveReason(''); setRemoveError(null); }}>Cancel</Button>
            <Button variant={removalPlan(removeTarget)?.kind === 'delete' ? 'danger' : 'secondary'} onClick={handleRemoveSlot} loading={removing}>
              {removalPlan(removeTarget)?.kind === 'delete' ? 'Delete Slot' : 'Mark Out of Service'}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {removeTarget && (() => {
            const plan = removalPlan(removeTarget)!;
            const tone = plan.kind === 'blocked' ? 'amber' : plan.kind === 'delete' ? 'red' : 'blue';
            const box = tone === 'red' ? 'border-red-300 bg-red-50 text-red-800' : tone === 'amber' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-300 bg-blue-50 text-blue-800';
            return (
              <div className={`rounded-lg border px-3 py-2.5 text-xs ${box}`}>
                <p className="font-semibold">{plan.title}</p>
                <p className="mt-1 leading-relaxed">{plan.detail}</p>
                {plan.kind === 'delete' && !isAdmin && (
                  <p className="mt-1.5 font-medium">Deleting an unused slot requires an ADMIN. You can still mark it out of service.</p>
                )}
              </div>
            );
          })()}

          <div className="space-y-1">
            <label htmlFor="remove-reason" className="block text-xs font-medium text-slate-700">Reason (required)</label>
            <textarea
              id="remove-reason"
              value={removeReason}
              onChange={e => setRemoveReason(e.target.value)}
              rows={2}
              placeholder="e.g. damaged ground surface"
              className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none"
            />
            <p className={`text-[11px] ${removeReason.trim().length > 0 && removeReason.trim().length < 5 ? 'text-amber-600' : 'text-slate-500'}`}>
              {removeReason.trim().length < 5 ? 'At least 5 characters.' : 'Recorded in the server log.'}
            </p>
          </div>

          {removeError && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{removeError}</div>
          )}
        </div>
      </Modal>

      {/* key remounts the modal on every open/close, so it starts on the Assembly
          Stages tab and never shows the previous machine's cached history. */}
      <MachineHistoryModal
        key={historyMachineId ?? 'closed'}
        machineId={historyMachineId}
        serialNumber={historySerial}
        initialTab="stages"
        movements={historyMovements}
        onClose={() => setHistoryMachineId(null)}
      />

      <DriverDetailsModal
        key={driverDetails?.id ?? 'driver-closed'}
        driverId={driverDetails?.id ?? null}
        initialDriver={driverDetails?.driver ?? null}
        onClose={() => setDriverDetails(null)}
      />
    </div>
  );
}

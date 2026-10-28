'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { SectionCard } from '@/components/ui/Card';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { MachineStatusBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import MachineHistoryModal, { HistoryTab, Movement } from '@/components/MachineHistoryModal';
import { slotLabel } from '@/lib/format';
import { Search, Plus, MapPin, Clock, Truck } from 'lucide-react';

interface Machine {
  id: string; serialNumber: string; model: string; productionDate: string;
  status: 'AVAILABLE' | 'SOLD' | 'RESERVED' | 'UNDER_INSPECTION' | 'IN_REPAIR' | 'DISPATCHED';
  assemblyStage: number; parkStatus: string;
  barcode?: string | null;
  plannedSlotId?: string | null;
  currentSlot?: { id: string; row: number; col: number; yard: { name: string } };
  // getAllMachines already returns this, so the history modal reads it from page
  // state instead of refetching the machine.
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

const STATUS_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'UNDER_INSPECTION', label: 'Under Inspection' },
  { value: 'IN_REPAIR', label: 'In Repair' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'DISPATCHED', label: 'Dispatched' },
];

export default function MachineTracking() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [yards, setYards] = useState<Yard[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySummary | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [parkFilter, setParkFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  // History is opened by id rather than by holding the machine object, so the
  // Allocate modal and the History modal never share selection state and closing
  // one cannot clear the other.
  const [historyMachineId, setHistoryMachineId] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('stages');
  const [selectedYard, setSelectedYard] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [initialStockLoad, setInitialStockLoad] = useState(false);
  const [allocateRemark, setAllocateRemark] = useState('');
  const [allocateError, setAllocateError] = useState<string | null>(null);
  const [newMachine, setNewMachine] = useState({ serialNumber: '', model: '', productionDate: '', status: 'AVAILABLE' as Machine['status'] });
  const { token, user, isAuthenticated } = useAuth();
  const canManageMachines = isAuthenticated && ['ADMIN', 'YARD_MANAGER', 'OPERATOR'].includes(user?.role || '');
  // A machine not yet in a slot enters the yard only through Gate Control. Placing one
  // by hand is for the stock parked before go-live, while an Admin has Initial stock load on.
  const canStockLoad = initialStockLoad && ['ADMIN', 'YARD_MANAGER'].includes(user?.role || '');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; if (token) h['Authorization'] = `Bearer ${token}`; return h; };

  const fetchMachines = async () => {
    try {
      const res = await fetch(`${API_URL}/api/machines`, { headers: headers() });
      const data = await res.json();
      setMachines(Array.isArray(data) ? data : []);
    } catch { setMachines([]); } finally { setLoading(false); }
  };

  const fetchYards = async () => {
    try {
      const res = await fetch(`${API_URL}/api/yards`, { headers: headers() });
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
    try { const r = await fetch(`${API_URL}/api/yards/availability`, { headers: headers() }); const d = await r.json(); setAvailability(d ?? null); } catch { }
  };

  const fetchStockLoad = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/stock-load`, { headers: headers() });
      if (res.ok) setInitialStockLoad(!!(await res.json()).initialStockLoad);
    } catch { }
  };

  useEffect(() => { fetchMachines(); fetchYards(); fetchAvailability(); fetchStockLoad(); }, []);

  const applySearch = (value: string) => { setSearchTerm(value); setPage(1); };
  const applyStatusFilter = (value: string) => { setStatusFilter(value); setPage(1); };
  const applyParkFilter = (value: string) => { setParkFilter(value); setPage(1); };

  const filtered = machines.filter(m => {
    const matchesSearch = m.serialNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.model?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || m.status === statusFilter;
    const matchesPark = !parkFilter || m.parkStatus === parkFilter;
    return matchesSearch && matchesStatus && matchesPark;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const parkStatusOptions = Array.from(new Set(machines.map(m => m.parkStatus).filter(Boolean))).map(v => ({ value: v, label: v }));

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/machines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(newMachine),
      });
      if (res.ok) { await fetchMachines(); setShowAddModal(false); setNewMachine({ serialNumber: '', model: '', productionDate: '', status: 'AVAILABLE' }); }
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

  /**
   * Open the history modal on the requested tab.
   *
   * This used to refetch GET /api/machines/:id purely to read `movements`, but the
   * machines list already carries that field, so the refetch was redundant. The
   * modal now reads movements from the selected machine in page state.
   */
  const openHistory = (machine: Machine, tab: HistoryTab) => {
    setHistoryTab(tab);
    setHistoryMachineId(machine.id);
  };

  const historyMachine = historyMachineId ? machines.find(m => m.id === historyMachineId) ?? null : null;

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Machine Tracking"
        description={`${machines.length} machines total`}
        actions={canManageMachines ? <Button icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>Add Machine</Button> : undefined}
      />

      {initialStockLoad && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Initial stock load is ON.</span>{' '}
          {canStockLoad
            ? 'You can place machines that are already parked in the yard with Allocate. Each needs Stage 18, a barcode and a remark, and still goes to Security.'
            : 'An Admin or Yard Manager is entering the machines already parked in the yard.'}
          {' '}Switch it off in Settings when the yard stock is entered.
        </p>
      )}

      <SectionCard
        title="Inventory"
        noPadding
        action={
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Input value={searchTerm} onChange={e => applySearch(e.target.value)} placeholder="Search by serial number or model..." icon={<Search className="w-4 h-4" />} className="w-full sm:w-72" />
            <Select value={statusFilter} onChange={e => applyStatusFilter(e.target.value)} options={[{ value: '', label: 'All Statuses' }, ...STATUS_OPTIONS]} className="w-full sm:w-44" />
            <Select value={parkFilter} onChange={e => applyParkFilter(e.target.value)} options={[{ value: '', label: 'All Park Statuses' }, ...parkStatusOptions]} className="w-full sm:w-44" />
          </div>
        }
      >

        {filtered.length === 0 ? (
          <EmptyState title="No machines found" description={searchTerm || statusFilter || parkFilter ? 'Try adjusting your filters' : 'Add your first machine to start tracking'} action={canManageMachines ? <Button size="sm" onClick={() => setShowAddModal(true)}>Add Machine</Button> : undefined} />
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableHeaderCell>Serial Number</TableHeaderCell>
                <TableHeaderCell>Model</TableHeaderCell>
                <TableHeaderCell>Assembly</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Park Status</TableHeaderCell>
                <TableHeaderCell>Location</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {paginated.map(m => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-blue-100 rounded-md flex items-center justify-center shrink-0">
                          <Truck className="w-3.5 h-3.5 text-blue-600" />
                        </div>
                        <span className="font-medium text-slate-900">{m.serialNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell>{m.model || 'N/A'}</TableCell>
                    <TableCell>
                      {m.assemblyStage > 0 ? (
                        <button
                          onClick={() => openHistory(m, 'stages')}
                          title="View assembly stage history"
                          aria-label={`View assembly stage history for ${m.serialNumber}`}
                          className="text-xs font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900 hover:decoration-blue-600 transition-colors cursor-pointer"
                        >
                          Stage {m.assemblyStage}/18
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400" title="No assembly stage recorded yet">—</span>
                      )}
                    </TableCell>
                    <TableCell><MachineStatusBadge status={m.status} /></TableCell>
                    <TableCell><ParkStatusBadge status={m.parkStatus} /></TableCell>
                    <TableCell>
                      {m.currentSlot ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-[13px]">{m.currentSlot.yard.name} ({slotLabel(m.currentSlot.row, m.currentSlot.col)})</span>
                        </div>
                      ) : m.plannedSlotId ? (
                        <span className="text-xs text-yellow-700 font-medium">Slot reserved</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {m.assemblyStage >= 18 && (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5" title="Ready to move but no slot is assigned at gate yet">Awaiting gate slot</span>
                          )}
                          {canStockLoad && <Button variant="ghost" size="sm" onClick={() => { setSelectedMachine(m); setShowAllocateModal(true); }}>Allocate</Button>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button variant="ghost" size="sm" onClick={() => openHistory(m, 'movements')} icon={<Clock className="w-3.5 h-3.5" />}>History</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
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
            {selectedYard && (
              (() => {
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
              })()
            )}
            <Input
              label="Remark (required)"
              value={allocateRemark}
              maxLength={480}
              onChange={e => setAllocateRemark(e.target.value)}
              placeholder="e.g. Parked before go-live, found in slot A-3"
            />
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
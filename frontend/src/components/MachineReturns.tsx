'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw, Truck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { MachineStatusBadge } from '@/components/ui/StatusBadge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Select from '@/components/ui/Select';
import { SectionCard } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';
import { formatDateTime, slotLabel } from '@/lib/format';
import { exitReasonLabel } from '@/lib/exitReasons';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

interface ReturnMachine {
  id: string;
  serialNumber: string;
  model: string;
  parkStatus: string;
  status: string;
  plannedSlotId: string | null;
  plannedSlot?: {
    id: string;
    row: number;
    col: number;
    status: string;
    yard?: { name: string } | null;
  } | null;
  exitRequest?: {
    id: string;
    reason: string;
    approvedAt: string | null;
    requestedBy: { id: string; name: string; email: string; role: string };
  } | null;
}

interface Yard {
  id: string;
  name: string;
  slots: Array<{ id: string; row: number; col: number; status: string }>;
}

export default function MachineReturns() {
  const { token, can } = useAuth();
  const canReserve = can('returns.reserve');

  const [items, setItems] = useState<ReturnMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  const [showReserve, setShowReserve] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<ReturnMachine | null>(null);
  const [yards, setYards] = useState<Yard[]>([]);
  const [selectedYard, setSelectedYard] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const headers = useCallback(() => {
    const requestHeaders: Record<string, string> = {};
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    return requestHeaders;
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/api/machines/returns`, { headers: headers(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return [] as ReturnMachine[];
        const data: unknown = await response.json();
        return Array.isArray(data) ? data as ReturnMachine[] : [];
      })
      .then(setItems)
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadTick, headers]);

  const openReserve = async (machine: ReturnMachine) => {
    setSelectedMachine(machine);
    setSelectedYard('');
    setSelectedSlot('');
    setFormError('');
    setShowReserve(true);
    fetch(`${API_URL}/api/yards`, { headers: headers() })
      .then(async (response) => {
        if (!response.ok) return [] as Yard[];
        const data: unknown = await response.json();
        return Array.isArray(data) ? data as Yard[] : [];
      })
      .then(async (yardsData) => {
        const withSlots = await Promise.all(
          yardsData.map(async (yard) => {
            const r = await fetch(`${API_URL}/api/yards/${yard.id}`, { headers: headers() });
            const d: unknown = await r.json().catch(() => null);
            const slotList = Array.isArray((d as { slots?: unknown } | null)?.slots)
              ? ((d as { slots: Array<Record<string, unknown>> }).slots)
                  .map((s) => ({
                    id: String(s.id),
                    row: Number(s.row),
                    col: Number(s.col),
                    status: String(s.status || 'AVAILABLE')
                  }))
              : [];
            return { ...yard, slots: slotList };
          })
        );
        setYards(withSlots);
      })
      .catch(() => {});
  };

  const closeReserve = () => {
    setShowReserve(false);
    setSelectedMachine(null);
    setSelectedYard('');
    setSelectedSlot('');
    setFormError('');
  };

  const handleReserve = async () => {
    if (!selectedMachine || !selectedSlot) return;
    setSubmitting(true);
    setFormError('');
    try {
      const res = await fetch(`${API_URL}/api/machines/${selectedMachine.id}/return-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ slotId: selectedSlot }),
      });
      if (!res.ok) {
        const err: unknown = await res.json().catch(() => null);
        const message = (err as { error?: string } | null)?.error;
        setFormError(message || 'Failed to reserve the slot');
        return;
      }
      closeReserve();
      setReloadTick((tick) => tick + 1);
    } catch {
      setFormError('Failed to reserve the slot');
    } finally {
      setSubmitting(false);
    }
  };

  const yard = yards.find((y) => y.id === selectedYard);
  const freeSlots = (yard?.slots || []).filter((s) => s.status === 'AVAILABLE');

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Returns"
        description="Machines that left for testing, inspection, repair, relocation or maintenance and are expected back. Reserve a slot first, then they can check in through the gate."
        actions={canReserve ? <Button variant="ghost" icon={<RefreshCw className="w-4 h-4" />} onClick={() => setReloadTick((tick) => tick + 1)}>Refresh</Button> : undefined}
      />

      <SectionCard title="Expected back" bodyClassName={items.length === 0 ? '' : 'p-0'}>
        {items.length === 0 ? (
          <EmptyState
            icon={<Truck className="w-6 h-6 text-slate-400" />}
            title="No machines expected back"
            description="Machines that left without being dispatched will appear here until they are checked back in at the gate."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>Serial Number</TableHeaderCell>
              <TableHeaderCell>Model</TableHeaderCell>
              <TableHeaderCell>Exit Reason</TableHeaderCell>
              <TableHeaderCell>Requested By</TableHeaderCell>
              <TableHeaderCell>Left</TableHeaderCell>
              <TableHeaderCell>Return Slot</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {items.map((machine) => (
                <TableRow key={machine.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-orange-100 rounded-md flex items-center justify-center shrink-0">
                        <Truck className="w-3.5 h-3.5 text-orange-600" />
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="font-medium text-slate-900">{machine.serialNumber}</span>
                        <MachineStatusBadge status={machine.status} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{machine.model || 'N/A'}</TableCell>
                  <TableCell>
                    <span className="text-[13px] font-medium text-slate-700">
                      {machine.exitRequest ? exitReasonLabel(machine.exitRequest.reason) : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">
                    {machine.exitRequest?.requestedBy?.name || '—'}
                  </TableCell>
                  <TableCell className="text-[13px] text-slate-600">
                    {machine.exitRequest?.approvedAt ? formatDateTime(machine.exitRequest.approvedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    {machine.plannedSlot ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-xs font-semibold">
                        <MapPin className="w-3 h-3" />
                        {machine.plannedSlot.yard?.name} ({slotLabel(machine.plannedSlot.row, machine.plannedSlot.col)})
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No slot reserved</span>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {canReserve && !machine.plannedSlot && (
                      <Button size="sm" variant="ghost" onClick={() => openReserve(machine)}>
                        Reserve Slot
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Modal
        open={showReserve}
        onClose={closeReserve}
        title="Reserve Return Slot"
        footer={
          <>
            <Button variant="secondary" onClick={closeReserve}>Cancel</Button>
            <Button onClick={handleReserve} loading={submitting} disabled={!selectedSlot}>Reserve Slot</Button>
          </>
        }
      >
        {selectedMachine && (
          <div className="space-y-3.5">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-500">Machine</p>
              <p className="text-[13px] font-semibold text-slate-900">{selectedMachine.serialNumber} — {selectedMachine.model}</p>
            </div>
            <p className="text-[11px] text-slate-500">
              Once reserved, the machine can be checked back in at Gate → Inward. The slot will be held until it arrives.
            </p>
            <Select label="Select Yard" value={selectedYard} onChange={(e) => { setSelectedYard(e.target.value); setSelectedSlot(''); }} placeholder="Choose a yard" options={yards.map((y) => {
              const free = (y.slots || []).filter((s) => s.status === 'AVAILABLE').length;
              return { value: y.id, label: `${y.name} — ${free} free` };
            })} />
            {selectedYard && (
              freeSlots.length === 0 ? (
                <div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50">
                  <p className="text-xs font-semibold text-yellow-800">{yard ? `${yard.name} has no available slots` : 'Choose a yard first'}</p>
                  <p className="text-[11px] text-yellow-700 mt-0.5">All of this yard&apos;s slots are currently taken or reserved. Choose another yard.</p>
                </div>
              ) : (
                <Select label="Select Slot" value={selectedSlot} onChange={(e) => setSelectedSlot(e.target.value)} placeholder="Choose a slot" options={freeSlots.map((s) => ({ value: s.id, label: `Slot ${slotLabel(s.row, s.col)}` }))} />
              )
            )}
            {formError && <p className="text-xs font-medium text-red-700">{formError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
'use client';

import { useState, useEffect, useCallback } from 'react';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Toolbar from '@/components/ui/Toolbar';
import Pagination from '@/components/ui/Pagination';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import Badge, { type BadgeProps } from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { slotLabel, formatDateTime } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { isYardRecorder } from '@/lib/roles';
import { Clock, ArrowLeftRight, Shield, CarFront } from 'lucide-react';

interface Movement {
  id: string;
  timestamp: string;
  reason: string;
  notes?: string | null;
  machine?: { id: string; serialNumber: string; model: string };
  machineId?: string;
  machineModel?: string;
  yard?: { name: string } | null;
  // A relocation writes the destination yard onto the movement itself, so the
  // slot's own yard is the only reliable label for the origin of a cross-yard
  // move. It is optional so an older payload still renders.
  fromSlot?: { row: number; col: number; yard?: { name: string } | null } | null;
  toSlot?: { row: number; col: number; yard?: { name: string } | null } | null;
  user?: { name: string; role?: string } | null;
}

interface PaginatedMovements {
  items: Movement[];
  total: number;
  page: number;
  pageSize: number;
}

interface Verification {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  comments?: string | null;
  verifiedAt: string;
  machine: { id: string; serialNumber: string; model: string };
  slot: { row: number; col: number; yard: { name: string } };
  user: { id: string; name: string };
}

interface PaginatedVerifications {
  items: Verification[];
  total: number;
  page: number;
  pageSize: number;
}

const REASON_VARIANTS: Record<string, BadgeProps['variant']> = { PRODUCTION: 'blue', INSPECTION: 'purple', REPAIR: 'orange', DISPATCH: 'green', RELOCATION: 'amber', MAINTENANCE: 'gray', YARD_ENTRY: 'green' };

type HistoryMode = 'movements' | 'parking' | 'verifications';

export default function MovementHistory() {
  const { can } = useAuth();
  const canViewVerifications = can('history.verifications');
  const [mode, setMode] = useState<HistoryMode>('movements');
  const [movements, setMovements] = useState<PaginatedMovements>({ items: [], total: 0, page: 1, pageSize: 15 });
  const [parking, setParking] = useState<PaginatedMovements>({ items: [], total: 0, page: 1, pageSize: 15 });
  const [verifications, setVerifications] = useState<PaginatedVerifications>({ items: [], total: 0, page: 1, pageSize: 15 });
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMachine, setSelectedMachine] = useState('');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = useCallback(() => {
    const t = localStorage.getItem('token');
    const h: Record<string, string> = {};
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }, []);

  const fetchMachines = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/machines`, { headers: headers() });
      if (r.ok) setMachines(await r.json());
    } catch { }
  }, [API_URL, headers]);

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedMachine) qs.set('machineId', selectedMachine);
      qs.set('page', String(movements.page));
      qs.set('pageSize', String(movements.pageSize));
      const r = await fetch(`${API_URL}/api/movements?${qs}`, { headers: headers() });
      if (r.ok) setMovements(await r.json());
    } catch { } finally { setLoading(false); }
  }, [API_URL, headers, movements.page, movements.pageSize, selectedMachine]);

  const fetchParking = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('reason', 'YARD_ENTRY');
      if (selectedMachine) qs.set('machineId', selectedMachine);
      qs.set('page', String(parking.page));
      qs.set('pageSize', String(parking.pageSize));
      const r = await fetch(`${API_URL}/api/movements?${qs}`, { headers: headers() });
      if (r.ok) setParking(await r.json());
    } catch { } finally { setLoading(false); }
  }, [API_URL, headers, parking.page, parking.pageSize, selectedMachine]);

  const fetchVerifications = useCallback(async () => {
    if (!canViewVerifications) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedMachine) qs.set('machineId', selectedMachine);
      qs.set('page', String(verifications.page));
      qs.set('pageSize', String(verifications.pageSize));
      const r = await fetch(`${API_URL}/api/security/verifications?${qs}`, { headers: headers() });
      if (r.ok) setVerifications(await r.json());
    } catch { } finally { setLoading(false); }
  }, [API_URL, headers, verifications.page, verifications.pageSize, selectedMachine, canViewVerifications]);

  useEffect(() => { fetchMachines(); }, [fetchMachines]);

  useEffect(() => {
    if (mode === 'movements') fetchMovements();
    else if (mode === 'parking') fetchParking();
    else if (mode === 'verifications') fetchVerifications();
  }, [mode, fetchMovements, fetchParking, fetchVerifications]);

  if (loading && mode === 'movements' && movements.total === 0) return <PageSpinner />;

  const title = mode === 'movements' ? 'Movement History' : mode === 'parking' ? 'Parking History' : 'Security Verification History';
  const count = mode === 'movements' ? movements.total : mode === 'parking' ? parking.total : verifications.total;
  const countLabel = `${count} ${mode === 'verifications' ? 'verification' : mode === 'parking' ? 'parking record' : 'movement'}${count !== 1 ? 's' : ''}`;

  const setMovementPage = (p: number) => { if (mode === 'movements') setMovements(m => ({ ...m, page: p })); else setParking(pk => ({ ...pk, page: p })); };
  const setMovementPageSize = (s: number) => { if (mode === 'movements') setMovements(m => ({ ...m, pageSize: s, page: 1 })); else setParking(pk => ({ ...pk, pageSize: s, page: 1 })); };
  const setVerificationPage = (p: number) => setVerifications(v => ({ ...v, page: p }));
  const setVerificationPageSize = (s: number) => setVerifications(v => ({ ...v, pageSize: s, page: 1 }));

  const modeButton = (id: HistoryMode, label: string) => (
    <button
      key={id}
      role="tab"
      aria-selected={mode === id}
      onClick={() => setMode(id)}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
        mode === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {id === 'movements' ? <ArrowLeftRight className="w-3.5 h-3.5" /> : id === 'parking' ? <CarFront className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
      {label}
    </button>
  );

  const showMachineFilter = mode !== 'verifications';
  const emptyTitle = mode === 'movements' ? 'No movement history' : mode === 'parking' ? 'No parking history' : 'No verification history';
  const emptyDescription = mode === 'movements' ? 'Movements will appear after machines are allocated' : mode === 'parking' ? 'Parking confirmations will appear after a machine is parked and checked in' : 'Security walk-down decisions will appear after a machine is verified';

  return (
    <div className="space-y-3">
      <PageHeader title={title} description={countLabel} />

      <SectionCard title={title} bodyClassName={(mode === 'verifications' ? verifications.items.length === 0 : mode === 'parking' ? parking.items.length === 0 : movements.items.length === 0) ? '' : 'p-0'}>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4" role="tablist">
          {modeButton('movements', 'Movements')}
          {modeButton('parking', 'Parking')}
          {canViewVerifications && modeButton('verifications', 'Verifications')}
        </div>
        <Toolbar className="px-4 py-3 border-b border-slate-100">
          {showMachineFilter && (
            <Select value={selectedMachine} onChange={e => setSelectedMachine(e.target.value)} placeholder="All Machines" options={machines.map(m => ({ value: m.id, label: m.serialNumber }))} className="w-full sm:w-64" />
          )}
        </Toolbar>
        {mode === 'movements' && movements.items.length === 0 && (
          <EmptyState icon={<Clock className="w-6 h-6 text-slate-400" />} title={emptyTitle} description={emptyDescription} />
        )}
        {mode === 'parking' && parking.items.length === 0 && (
          <EmptyState icon={<CarFront className="w-6 h-6 text-slate-400" />} title={emptyTitle} description={emptyDescription} />
        )}
        {mode === 'verifications' && verifications.items.length === 0 && (
          <EmptyState icon={<Shield className="w-6 h-6 text-slate-400" />} title={emptyTitle} description={emptyDescription} />
        )}

        {mode === 'movements' && movements.items.length > 0 && (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Machine</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>To</TableHeaderCell><TableHeaderCell>Reason</TableHeaderCell><TableHeaderCell>User</TableHeaderCell></TableHeader>
              <TableBody>
                {movements.items.map(mv => (
                  <TableRow key={mv.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(mv.timestamp)}</TableCell>
                    <TableCell><span className="font-medium text-slate-900">{mv.machine?.serialNumber || mv.machineId || 'N/A'}</span></TableCell>
                    <TableCell>{mv.fromSlot && mv.yard ? `${mv.fromSlot.yard?.name || mv.yard.name} (${slotLabel(mv.fromSlot.row, mv.fromSlot.col)})` : '—'}</TableCell>
                    <TableCell>{mv.toSlot && mv.yard ? `${mv.toSlot.yard?.name || mv.yard.name} (${slotLabel(mv.toSlot.row, mv.toSlot.col)})` : '—'}</TableCell>
                    <TableCell><Badge variant={REASON_VARIANTS[mv.reason] || 'gray'}>{mv.reason}</Badge></TableCell>
                    <TableCell>{mv.user?.name || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={movements.total} page={movements.page} pageSize={movements.pageSize} onPageChange={setMovementPage} onPageSizeChange={setMovementPageSize} compact />
          </div>
        )}

        {mode === 'parking' && parking.items.length > 0 && (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Machine</TableHeaderCell><TableHeaderCell>Yard</TableHeaderCell><TableHeaderCell>Slot</TableHeaderCell><TableHeaderCell>Recorded by</TableHeaderCell><TableHeaderCell>Notes</TableHeaderCell></TableHeader>
              <TableBody>
                {parking.items.map(mv => (
                  <TableRow key={mv.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(mv.timestamp)}</TableCell>
                    <TableCell><span className="font-medium text-slate-900">{mv.machine?.serialNumber || 'N/A'}</span></TableCell>
                    <TableCell>{mv.yard?.name || '—'}</TableCell>
                    <TableCell>{mv.toSlot ? slotLabel(mv.toSlot.row, mv.toSlot.col) : '—'}</TableCell>
                    <TableCell>
                      <span className="font-medium text-slate-900">{mv.user?.name || '—'}</span>
                      <span className="ml-2 text-xs text-slate-400">{isYardRecorder(mv.user?.role) ? 'Yard office' : 'Driver'}</span>
                    </TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal text-xs text-slate-500">{mv.notes || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={parking.total} page={parking.page} pageSize={parking.pageSize} onPageChange={setMovementPage} onPageSizeChange={setMovementPageSize} compact />
          </div>
        )}

        {mode === 'verifications' && verifications.items.length > 0 && (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell>Machine</TableHeaderCell><TableHeaderCell>Yard</TableHeaderCell><TableHeaderCell>Slot</TableHeaderCell><TableHeaderCell>Result</TableHeaderCell><TableHeaderCell>Verified by</TableHeaderCell><TableHeaderCell>Comments</TableHeaderCell></TableHeader>
              <TableBody>
                {verifications.items.map(v => (
                  <TableRow key={v.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(v.verifiedAt)}</TableCell>
                    <TableCell><span className="font-medium text-slate-900">{v.machine?.serialNumber || 'N/A'}</span></TableCell>
                    <TableCell>{v.slot?.yard?.name || '—'}</TableCell>
                    <TableCell>{v.slot ? slotLabel(v.slot.row, v.slot.col) : '—'}</TableCell>
                    <TableCell><Badge variant={v.status === 'APPROVED' ? 'green' : 'red'}>{v.status}</Badge></TableCell>
                    <TableCell>{v.user?.name || '—'}</TableCell>
                    <TableCell className="max-w-[240px] whitespace-normal text-xs text-slate-500">{v.comments || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={verifications.total} page={verifications.page} pageSize={verifications.pageSize} onPageChange={setVerificationPage} onPageSizeChange={setVerificationPageSize} compact />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import { AssemblyStageBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import { PageSpinner } from '@/components/ui/Spinner';
import StageTimeline, { StageRow, StageSummary } from '@/components/StageTimeline';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { slotLabel, formatDateTime } from '@/lib/format';
import { useAuth } from '@/contexts/AuthContext';
import { canViewSecurityHistory, isYardRecorder } from '@/lib/roles';
import { AlertCircle, History, Info, ArrowLeftRight, Lock, CarFront, Shield } from 'lucide-react';

export type HistoryTab = 'stages' | 'movements' | 'parking' | 'security';

export interface Movement {
  id: string;
  timestamp: string;
  reason: string;
  notes?: string | null;
  fromSlot?: { row: number; col: number; yard?: { name: string } | null } | null;
  toSlot?: { row: number; col: number; yard?: { name: string } | null } | null;
  yard?: { name: string } | null;
  user?: { name: string; role?: string } | null;
}

export interface VerificationRecord {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  comments?: string | null;
  verifiedAt: string;
  slot: { row: number; col: number; yard: { name: string } };
  user: { name: string };
}

interface HistoryMachine {
  id: string;
  serialNumber: string;
  model: string;
  barcode?: string;
  orderNo?: string;
  itemCode?: string;
  itemDescription?: string;
  assemblyStage: number;
  parkStatus: string;
  isDemo?: boolean;
}

interface HistoryResponse {
  machine: HistoryMachine;
  summary: StageSummary;
  stages: StageRow[];
}

interface MachineHistoryModalProps {
  machineId: string | null;
  serialNumber?: string;
  /** Which tab to open on. The Assembly column passes 'stages', the History button 'movements'. */
  initialTab?: HistoryTab;
  /** Movements come from the machines list already loaded by the page, so no refetch. */
  movements?: Movement[] | null;
  onClose: () => void;
}

/**
 * One history modal with two tabs.
 *
 * Assembly stages and slot movements are separate datasets with separate endpoints,
 * and only one of them exists per machine type: a machine still at stage 3 has stage
 * history but no movements, while a machine parked and relocated has movements but
 * no further stage data. Presenting them as tabs keeps both reachable from the
 * Machine Tracking screen without adding a second button to an already crowded row.
 */
export default function MachineHistoryModal({
  machineId,
  serialNumber,
  initialTab = 'stages',
  movements,
  onClose
}: MachineHistoryModalProps) {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const [data, setData] = useState<HistoryResponse | null>(null);
  // Tagged with the machine it belongs to so switching machines mid-load cannot
  // show another machine's stages.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [verifications, setVerifications] = useState<VerificationRecord[] | null>(null);
  const [verificationsLoadedFor, setVerificationsLoadedFor] = useState<string | null>(null);
  const [verificationFailure, setVerificationFailure] = useState<{ id: string; message: string } | null>(null);
  const { user } = useAuth();
  const canViewVerifications = canViewSecurityHistory(user?.role);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // The caller passes key={machineId}, so opening a different machine remounts this
  // component. That makes initialTab the starting tab, and it also discards the
  // previous machine's payload on close, so a reopened machine always refetches
  // instead of rendering data that a sync may since have changed. No reset effects
  // are needed for either.

  // Stage history is only fetched when the stages tab is actually shown. Opening
  // straight onto Movements should not pay for a request the user never sees.
  useEffect(() => {
    if (!machineId) return;
    if (tab !== 'stages') return;
    if (loadedFor === machineId) return;

    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem('token');

        // The history endpoint is authenticated while the machine list is not, so
        // an anonymous visitor gets a readable message instead of a raw 401.
        if (!token) {
          setData(null);
          setFailure({ id: machineId, message: 'Sign in to view assembly stage history.' });
          return;
        }

        const res = await fetch(`${API_URL}/api/machines/${machineId}/history`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok) {
          setData(null);
          setFailure({ id: machineId, message: body?.error || `Failed to load stage history (${res.status})` });
          return;
        }

        setFailure(null);
        setData(body);
        setLoadedFor(machineId);
      } catch (e) {
        if (cancelled) return;
        setData(null);
        setFailure({
          id: machineId,
          message: e instanceof Error ? e.message : 'Failed to load stage history'
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [machineId, tab, loadedFor, API_URL]);

  const error = failure && machineId && failure.id === machineId ? failure.message : null;
  // A payload only counts once it belongs to the machine currently open.
  const current = data && machineId && data.machine?.id === machineId ? data : null;
  // Derived rather than stored, so the spinner cannot get stuck on if a request
  // fails or the modal is dismissed mid-load.
  const isLoading = machineId !== null && tab === 'stages' && error === null && current === null && loadedFor !== machineId;
  const machine = current?.machine;
  const rows = movements ?? [];
  // Parking is stored as YARD_ENTRY movements, so this tab is a filtered view of
  // the movements the caller already supplied rather than a second request.
  const parkRows = rows.filter(mv => mv.reason === 'YARD_ENTRY');

  // Verifications have no other source, so they are fetched, and only when the
  // tab is actually shown and the caller's role allows reading them.
  useEffect(() => {
    if (!machineId) return;
    if (tab !== 'security') return;
    if (!canViewVerifications) return;
    if (verificationsLoadedFor === machineId) return;

    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setVerificationFailure({ id: machineId, message: 'Sign in to view security verification history.' });
          return;
        }
        const res = await fetch(
          `${API_URL}/api/security/verifications?machineId=${encodeURIComponent(machineId)}&pageSize=50`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setVerificationFailure({ id: machineId, message: body?.error || `Failed to load verification history (${res.status})` });
          return;
        }
        setVerificationFailure(null);
        setVerifications(Array.isArray(body?.items) ? body.items : []);
        setVerificationsLoadedFor(machineId);
      } catch (e) {
        if (cancelled) return;
        setVerificationFailure({
          id: machineId,
          message: e instanceof Error ? e.message : 'Failed to load verification history'
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [machineId, tab, verificationsLoadedFor, canViewVerifications, API_URL]);

  const verificationError = verificationFailure && machineId && verificationFailure.id === machineId ? verificationFailure.message : null;
  const verificationRows = verificationsLoadedFor === machineId && Array.isArray(verifications) ? verifications : null;
  const isVerificationsLoading = machineId !== null && tab === 'security' && canViewVerifications && verificationError === null && verificationRows === null;

  const tabIcon = (id: HistoryTab) => {
    if (id === 'stages') return <History className="h-3.5 w-3.5" />;
    if (id === 'movements') return <ArrowLeftRight className="h-3.5 w-3.5" />;
    if (id === 'parking') return <CarFront className="h-3.5 w-3.5" />;
    return <Shield className="h-3.5 w-3.5" />;
  };

  const tabButton = (id: HistoryTab, label: string, count: number | null) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
        tab === id
          ? 'border-indigo-600 text-indigo-700'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {tabIcon(id)}
      {label}
      {count !== null && (
        <span className={`rounded-full px-1.5 py-px text-[9px] font-bold tabular-nums ${
          tab === id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
        }`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <Modal
      open={machineId !== null}
      onClose={onClose}
      size="xl"
      title={machine ? `History — ${machine.serialNumber}` : 'Machine History'}
      subtitle={machine?.orderNo ? `Order ${machine.orderNo}` : serialNumber}
    >
      <div className="space-y-4">
        {/* Identity, only once the stages payload has identified the machine. The
            Movements tab relies on the serial passed in by the caller instead. */}
        {machine && tab === 'stages' && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            {machine.isDemo && (
              <p className="mb-2.5 inline-flex items-center gap-1.5 rounded border border-purple-200 bg-purple-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
                Demo machine — sample data, not plant production
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Serial</p>
                <p className="text-[13px] font-medium text-slate-900">{machine.serialNumber}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Order</p>
                <p className="text-[13px] font-mono text-slate-700">{machine.orderNo || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Barcode</p>
                <p className="text-[13px] font-mono text-slate-700">{machine.barcode || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Item</p>
                <p className="text-[13px] text-slate-700">
                  {machine.itemCode || '—'}
                  {machine.itemDescription && (
                    <span className="ml-1.5 text-[11px] text-slate-500">{machine.itemDescription}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Stage</p>
                  <div className="mt-0.5"><AssemblyStageBadge stage={machine.assemblyStage} /></div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Park</p>
                  <div className="mt-0.5"><ParkStatusBadge status={machine.parkStatus} /></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
          {tabButton('stages', 'Assembly Stages', current?.summary.recordedCount ?? null)}
          {tabButton('movements', 'Movements', rows.length)}
          {tabButton('parking', 'Parking', parkRows.length)}
          {canViewVerifications && tabButton('security', 'Security', verificationRows?.length ?? null)}
        </div>

        {tab === 'stages' && (
          <div className="space-y-4">
            {isLoading && <PageSpinner />}

            {!isLoading && error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {error.startsWith('Sign in') ? (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="text-xs leading-relaxed">{error}</span>
              </div>
            )}

            {!isLoading && !error && current && (
              <StageTimeline summary={current.summary} stages={current.stages} />
            )}
          </div>
        )}

        {tab === 'movements' && (
          rows.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-xs leading-relaxed">
                No movement history. A movement is recorded each time this machine is allocated to a
                different yard slot.
              </span>
            </div>
          ) : (
            <Table maxHeight={420}>
              <TableHeader sticky>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>From</TableHeaderCell>
                <TableHeaderCell>To</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>User</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {rows.map((mv) => (
                  <TableRow key={mv.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(mv.timestamp)}</TableCell>
                    <TableCell>{mv.fromSlot && mv.yard ? `${mv.fromSlot.yard?.name || mv.yard.name} (${slotLabel(mv.fromSlot.row, mv.fromSlot.col)})` : '—'}</TableCell>
                    <TableCell>{mv.toSlot && mv.yard ? `${mv.toSlot.yard?.name || mv.yard.name} (${slotLabel(mv.toSlot.row, mv.toSlot.col)})` : '—'}</TableCell>
                    <TableCell><Badge variant="blue" size="sm">{mv.reason}</Badge></TableCell>
                    <TableCell>{mv.user?.name || 'System'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
        {tab === 'parking' && (
          parkRows.length === 0 ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-xs leading-relaxed">
                No parking history. A record is added here the moment this machine is confirmed parked at its
                slot, whether the driver or the yard office entered it.
              </span>
            </div>
          ) : (
            <Table maxHeight={420}>
              <TableHeader sticky>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Recorded by</TableHeaderCell>
                <TableHeaderCell>Notes</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {parkRows.map((mv) => (
                  <TableRow key={mv.id}>
                    <TableCell className="text-xs text-slate-500">{formatDateTime(mv.timestamp)}</TableCell>
                    <TableCell>{mv.toSlot && mv.yard ? `${mv.toSlot.yard?.name || mv.yard.name} (${slotLabel(mv.toSlot.row, mv.toSlot.col)})` : '—'}</TableCell>
                    <TableCell>
                      {mv.user?.name || 'System'}
                      <span className="ml-1.5 text-xs text-slate-400">{isYardRecorder(mv.user?.role) ? 'Yard office' : 'Driver'}</span>
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal text-xs text-slate-500">{mv.notes || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}

        {tab === 'security' && (
          <div className="space-y-3">
            {isVerificationsLoading && <PageSpinner />}

            {!isVerificationsLoading && verificationError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {verificationError.startsWith('Sign in') ? (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="text-xs leading-relaxed">{verificationError}</span>
              </div>
            )}

            {!isVerificationsLoading && !verificationError && verificationRows && verificationRows.length === 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="text-xs leading-relaxed">
                  No verification history. A record is added here each time security approves or rejects this
                  machine&apos;s parking.
                </span>
              </div>
            )}

            {!isVerificationsLoading && !verificationError && verificationRows && verificationRows.length > 0 && (
              <Table maxHeight={420}>
                <TableHeader sticky>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Slot</TableHeaderCell>
                  <TableHeaderCell>Result</TableHeaderCell>
                  <TableHeaderCell>Verified by</TableHeaderCell>
                  <TableHeaderCell>Comments</TableHeaderCell>
                </TableHeader>
                <TableBody>
                  {verificationRows.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-xs text-slate-500">{formatDateTime(v.verifiedAt)}</TableCell>
                      <TableCell>{v.slot?.yard?.name ? `${v.slot.yard.name} (${slotLabel(v.slot.row, v.slot.col)})` : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={v.status === 'APPROVED' ? 'green' : 'red'} size="sm">{v.status}</Badge>
                      </TableCell>
                      <TableCell>{v.user?.name || '—'}</TableCell>
                      <TableCell className="max-w-[220px] whitespace-normal text-xs text-slate-500">{v.comments || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

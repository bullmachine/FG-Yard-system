'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Plus, RefreshCw, Send, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Select from '@/components/ui/Select';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';
import { formatDateTime } from '@/lib/format';
import { EXIT_REASON_OPTIONS, exitReasonLabel } from '@/lib/exitReasons';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

type ExitRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';

interface ExitRequest {
  id: string;
  machineId: string;
  reason: string;
  notes: string | null;
  status: ExitRequestStatus;
  rejectReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  machine: {
    id: string;
    serialNumber: string;
    model: string;
    parkStatus: string;
    status: string;
    currentSlotId: string | null;
  };
  requestedBy: { id: string; name: string; email: string; role: string };
  approvedBy: { id: string; name: string } | null;
}

interface MachineOption {
  id: string;
  serialNumber: string;
  model: string;
  parkStatus: string;
  currentSlotId: string | null;
  slotLabel: string | null;
}

const REASON_OPTIONS = EXIT_REASON_OPTIONS;

const STATUS_META: Record<ExitRequestStatus, { label: string; variant: 'amber' | 'blue' | 'red' | 'green' }> = {
  PENDING: { label: 'Pending', variant: 'amber' },
  APPROVED: { label: 'Approved', variant: 'blue' },
  REJECTED: { label: 'Rejected', variant: 'red' },
  COMPLETED: { label: 'Completed', variant: 'green' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'COMPLETED', label: 'Completed' },
];

const reasonLabel = exitReasonLabel;

export default function ExitRequests() {
  const { token, user } = useAuth();
  const role = user?.role;
  const isManager = role === 'ADMIN' || role === 'YARD_MANAGER';
  const canRequest = !!user;

  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [reason, setReason] = useState('INSPECTION');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [rejecting, setRejecting] = useState<ExitRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const headers = () => {
    const requestHeaders: Record<string, string> = {};
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    return requestHeaders;
  };

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/api/exit-requests`, { headers: headers(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return [] as ExitRequest[];
        const data: unknown = await response.json();
        return Array.isArray(data) ? data as ExitRequest[] : [];
      })
      .then(setRequests)
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    fetch(`${API_URL}/api/machines`, { headers: headers(), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return [] as MachineOption[];
        const data: unknown = await response.json();
        if (!Array.isArray(data)) return [] as MachineOption[];
        return (data as Array<Record<string, unknown>>)
          .filter((m) => m.currentSlotId && m.parkStatus !== 'AT_GATE' && m.parkStatus !== 'EXITED')
          .map((m) => ({
            id: String(m.id),
            serialNumber: String(m.serialNumber),
            model: String(m.model),
            parkStatus: String(m.parkStatus),
            currentSlotId: String(m.currentSlotId),
            slotLabel: (m.currentSlot as { row?: number; col?: number } | null)
              ? `${(m.currentSlot as { row?: number }).row}-${(m.currentSlot as { col?: number }).col}`
              : null
          }));
      })
      .then(setMachines)
      .catch(() => {});

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reloadTick]);

  const reload = () => setReloadTick((tick) => tick + 1);

  const visible = statusFilter === '' ? requests : requests.filter((r) => r.status === statusFilter);

  const openNew = () => {
    setFormError('');
    setMachineId('');
    setReason('INSPECTION');
    setNotes('');
    setShowNew(true);
  };

  const createRequest = async () => {
    setFormError('');
    if (!machineId) {
      setFormError('Select the machine to take out.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/exit-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ machineId, reason, notes })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(body?.error || `Request failed (${response.status})`);
        return;
      }
      setShowNew(false);
      reload();
    } catch {
      setFormError('Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (request: ExitRequest, outcome: 'approve' | 'reject') => {
    setBusyId(request.id);
    setRejectError('');
    try {
      const response = await fetch(`${API_URL}/api/exit-requests/${request.id}/${outcome}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: outcome === 'reject' ? JSON.stringify({ reason: rejectReason }) : JSON.stringify({})
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRejectError(body?.error || `Action failed (${response.status})`);
        return;
      }
      setRejecting(null);
      setRejectReason('');
      reload();
    } catch {
      setRejectError('Could not reach the server');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Exit Requests"
        description={
          isManager
            ? 'Review requests to take machines out of the yard. Approval frees the slot and sends the machine to the gate; security sees it in real time.'
            : 'Request to take a machine out of the yard (testing, inspection, repair, dispatch...). A yard manager must approve before the machine can leave.'
        }
        actions={
          <>
            {canRequest && (
              <Button icon={<Plus className="w-4 h-4" />} onClick={openNew} disabled={machines.length === 0}>
                New Request
              </Button>
            )}
            <Button
              variant="ghost"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={() => { setLoading(true); reload(); }}
            >
              Refresh
            </Button>
          </>
        }
      />

      {requests.length === 0 ? (
        <EmptyState
          title={isManager ? 'No exit requests yet' : 'No exit requests'}
          description="Request a machine you need to take out - the machine must be parked in a slot."
          action={<Button icon={<Plus className="w-4 h-4" />} onClick={openNew}>New Request</Button>}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {visible.length} request{visible.length !== 1 ? 's' : ''}
              {statusFilter ? ` · ${STATUS_META[statusFilter as ExitRequestStatus].label.toLowerCase()}` : ''}
            </p>
            <div className="w-56">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={STATUS_OPTIONS} />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableHeaderCell>Machine</TableHeaderCell>
                <TableHeaderCell>Purpose</TableHeaderCell>
                <TableHeaderCell>Requested by</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Requested at</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {visible.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <p className="text-[13px] font-medium text-slate-900">{request.machine.serialNumber}</p>
                      <p className="text-xs text-slate-500">{request.machine.model}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-[13px] text-slate-800">{reasonLabel(request.reason)}</p>
                      {request.notes && <p className="text-xs text-slate-500 max-w-[220px] truncate" title={request.notes}>{request.notes}</p>}
                    </TableCell>
                    <TableCell>
                      <p className="text-[13px] text-slate-800">{request.requestedBy.name}</p>
                      <p className="text-xs text-slate-500">{request.requestedBy.role?.replace('_', ' ')}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_META[request.status].variant} dot>{STATUS_META[request.status].label}</Badge>
                      {request.status === 'REJECTED' && request.rejectReason && (
                        <p className="text-[11px] text-red-600 mt-1 max-w-[180px] truncate" title={request.rejectReason}>
                          {request.rejectReason}
                        </p>
                      )}
                      {request.status === 'APPROVED' && request.approvedBy && (
                        <p className="text-[11px] text-slate-500 mt-1">by {request.approvedBy.name}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-500">{formatDateTime(request.createdAt)}</span>
                      {request.status === 'APPROVED' && request.approvedAt && (
                        <p className="text-[11px] text-slate-400">approved {formatDateTime(request.approvedAt)}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isManager && request.status === 'PENDING' && (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="success"
                            loading={busyId === request.id}
                            disabled={busyId !== null && busyId !== request.id}
                            onClick={() => decide(request, 'approve')}
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busyId !== null && busyId !== request.id}
                            onClick={() => { setRejecting(request); setRejectReason(''); setRejectError(''); }}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                      {request.status !== 'PENDING' && <span className="text-[11px] text-slate-400">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* New request modal */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New Exit Request"
        subtitle="The machine must be parked in a slot. Approval releases the slot and marks it AT_GATE."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={createRequest} loading={submitting} icon={<Send className="w-4 h-4" />}>
              Submit Request
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {formError && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
              {formError}
            </div>
          )}
          <Select
            label="Machine"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            placeholder="Select a parked machine..."
            options={machines.map((m) => ({
              value: m.id,
              label: `${m.serialNumber} · ${m.model}${m.slotLabel ? ` · Slot ${m.slotLabel}` : ''}`
            }))}
          />
          <Select
            label="Purpose"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={REASON_OPTIONS}
          />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. field testing of hydraulic system"
              className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none"
            />
          </div>
        </div>
      </Modal>

      {/* Reject modal */}
      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject Exit Request"
        subtitle={rejecting ? `${rejecting.machine.serialNumber} · ${reasonLabel(rejecting.reason)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={busyId === rejecting?.id}
              disabled={!rejectReason.trim()}
              onClick={() => rejecting && decide(rejecting, 'reject')}
              icon={<XCircle className="w-4 h-4" />}
            >
              Reject Request
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {rejectError && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
              {rejectError}
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-700">Reason (required)</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder="Why is this exit not approved?"
              className="w-full px-3 py-1.5 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-none"
            />
            <p className="text-[11px] text-slate-500">Sent to the requester so they know why.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Button from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { slotLabel, formatDateTime } from '@/lib/format';
import { exitReasonLabel } from '@/lib/exitReasons';
import { useRealtimeEvent, useNotifications } from '@/contexts/NotificationContext';
import { useAuth } from '@/contexts/AuthContext';
import { CheckCircle2, XCircle, WifiOff, RefreshCw, Shield, LogOut } from 'lucide-react';

interface Machine {
  id: string;
  serialNumber: string;
  model?: string;
  parkStatus: string;
  currentSlot?: { id: string; yard: { name: string }; row: number; col: number };
  movements?: { toSlotId?: string | null; user?: { id: string; name: string } | null }[];
}

/** Who put the machine into its current slot (newest movement into that slot). */
function parkerOf(m: Machine) {
  return m.movements?.find((mv) => mv.toSlotId === m.currentSlot?.id)?.user ?? null;
}

interface Verification {
  id: string;
  status: 'APPROVED' | 'REJECTED';
  comments?: string | null;
  verifiedAt: string;
  machine: { serialNumber: string };
  slot: { row: number; col: number; yard: { name: string } };
  user: { name: string };
}

interface ApprovedExit {
  id: string;
  reason: string;
  notes: string | null;
  status: string;
  approvedAt: string | null;
  machine: { serialNumber: string; model: string | null; parkStatus: string };
  requestedBy: { name: string };
  approvedBy: { name: string } | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export default function SecurityVerification() {
  const [pending, setPending] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [recent, setRecent] = useState<Verification[]>([]);
  const [approvedExits, setApprovedExits] = useState<ApprovedExit[]>([]);
  const { connectionState } = useNotifications();
  const { user } = useAuth();
  const [twoPerson, setTwoPerson] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    fetch(`${API_URL}/api/settings/stock-load`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.parkingTwoPersonRule === 'boolean') setTwoPerson(d.parkingTwoPersonRule); })
      .catch(() => undefined);
  }, []);

  // Only the two statuses that need a guard. The server filters both the park
  // status and the demo rows, so this never downloads the full machine list.
  const fetchPending = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const r = await fetch(
        `${API_URL}/api/machines?parkStatus=PARKED_PENDING,PARKED_REJECTED`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );
      if (!r.ok) {
        setError(r.status === 403 ? 'You do not have permission to view the verification queue.' : 'Could not load the verification queue.');
        return;
      }
      const data = await r.json();
      setPending(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError('Could not reach the server. The queue will refresh when the connection returns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPending(true); }, [fetchPending]);

  // Decisions leave the queue as soon as they are made, so without this the
  // screen would only ever show what is still outstanding. The audit trail is
  // read separately because the queue endpoint is scoped to pending statuses.
  const fetchRecent = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/security/verifications?pageSize=8`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (r.ok) {
        const data = await r.json();
        setRecent(Array.isArray(data?.items) ? data.items : []);
      }
    } catch { /* the queue above still works without the trail */ }
  }, []);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // Approved exit requests stay visible to security until the gate lets the
  // machine out (the server flips them to COMPLETED, which the SECURITY-scoped
  // endpoint never returns). The inline .then chain keeps this list in sync
  // without turning a fetch function into a synchronous setState in the effect.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/api/exit-requests`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      signal: controller.signal
    })
      .then((r) => (r.ok
        ? r.json().then((d) => (Array.isArray(d) ? (d as ApprovedExit[]).filter((x) => x.status === 'APPROVED') : []))
        : []))
      .then(setApprovedExits)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const refetchApprovedExits = () => {
    fetch(`${API_URL}/api/exit-requests`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    })
      .then((r) => (r.ok
        ? r.json().then((d) => (Array.isArray(d) ? (d as ApprovedExit[]).filter((x) => x.status === 'APPROVED') : []))
        : []))
      .then(setApprovedExits)
      .catch(() => {});
  };

  // A yard manager approving/rejecting, or the gate worker letting a machine
  // out, fires exit-request so the guard's authorized list updates live.
  useRealtimeEvent('exit-request', () => { refetchApprovedExits(); fetchPending(); });

  // A driver confirming parked fires security-queue, so the guard's list updates
  // without a reload. Refreshing a second time shortly after is cheap and covers
  // a change made on another device while this tab was backgrounded.
  useRealtimeEvent('security-queue', () => { fetchPending(); fetchRecent(); });
  useEffect(() => {
    if (connectionState !== 'live') return;
    const onFocus = () => fetchPending();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [connectionState, fetchPending]);

  const handleVerify = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setVerifying(id);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/machines/${id}/verify-parking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({
          status,
          comments: status === 'REJECTED' ? (reason.trim() || 'Incorrect parking') : 'Verified'
        })
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error || `Could not ${status === 'APPROVED' ? 'approve' : 'reject'} this machine.`);
        return;
      }
      setRejectedId(null);
      setReason('');
      fetchPending();
      fetchRecent();
    } catch {
      setError('Could not reach the server. Nothing was saved, please try again.');
    } finally {
      inFlight.current = false;
      setVerifying(null);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Security Verification"
        description={`${pending.length} awaiting verification`}
        actions={
          <div className="flex items-center gap-3">
            {connectionState !== 'live' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                <WifiOff className="w-3.5 h-3.5" /> Live updates offline
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => fetchPending(true)} icon={<RefreshCw className="w-3.5 h-3.5" />}>
              Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {pending.length === 0 ? (
        <SectionCard title="All Clear">
          <EmptyState icon={<CheckCircle2 className="w-6 h-6 text-emerald-500" />} title="All Clear" description="No machines pending verification" />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pending.map(m => {
            const isRejected = m.parkStatus === 'PARKED_REJECTED';
            const busy = verifying === m.id;
            const parker = parkerOf(m);
            const ownPark = twoPerson && !!parker && parker.id === user?.id;
            return (
              <div key={m.id} className={`rounded-lg border p-4 ${isRejected ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-start justify-between mb-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-900 truncate">{m.serialNumber}</p>
                    {m.currentSlot && <p className="text-xs text-slate-500 mt-0.5 truncate">{m.currentSlot.yard.name} — Slot {slotLabel(m.currentSlot.row, m.currentSlot.col)}</p>}
                  </div>
                  <Badge variant={isRejected ? 'red' : 'amber'} dot>{isRejected ? 'RED' : 'YELLOW'}</Badge>
                </div>

                {parker && <p className="mb-2 text-[11px] text-slate-500">Parked by {ownPark ? 'you' : parker.name}</p>}
                {isRejected && (
                  <p className="mb-2.5 text-xs text-red-700">Rejected. The driver has been notified to re-park in this same slot.</p>
                )}
                {ownPark && (
                  <p className="mb-2.5 text-xs text-amber-800">You confirmed this parking, so another person must approve it (two-person rule). You can still reject it.</p>
                )}

                {rejectedId === m.id ? (
                  <div className="space-y-2">
                    <input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Reason for rejection"
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button variant="danger" size="sm" className="flex-1" onClick={() => handleVerify(m.id, 'REJECTED')} disabled={busy} loading={busy}>Confirm reject</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setRejectedId(null); setReason(''); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="success" size="sm" className="flex-1" onClick={() => handleVerify(m.id, 'APPROVED')} disabled={busy || ownPark} loading={busy} icon={<CheckCircle2 className="w-3.5 h-3.5" />}>Approve</Button>
                    <Button variant="danger" size="sm" className="flex-1" onClick={() => { setRejectedId(m.id); setReason(''); }} disabled={busy} icon={<XCircle className="w-3.5 h-3.5" />}>Reject</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Authorized exits: machines the yard manager has cleared to leave. They
          drop off automatically when the gate records them OUT (status flips to
          COMPLETED). */}
      <SectionCard title="Authorized Exits" description="Machines cleared to leave the yard - they drop off once the gate lets them out">
        {approvedExits.length === 0 ? (
          <EmptyState icon={<LogOut className="w-6 h-6 text-slate-400" />} title="No exits authorized" description="Approved exit requests appear here and disappear after the machine passes the gate" />
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {approvedExits.map(e => (
              <div key={e.id} className="p-2.5 rounded-lg border border-sky-200 bg-sky-50 text-xs">
                <div className="flex items-start justify-between mb-0.5 gap-2">
                  <span className="font-medium text-slate-900">{e.machine?.serialNumber}</span>
                  <Badge variant="blue" dot>AT GATE</Badge>
                </div>
                <p className="text-slate-600">{exitReasonLabel(e.reason)}{e.notes ? ` · ${e.notes}` : ''}</p>
                <p className="text-slate-400">
                  By {e.requestedBy?.name} · approved {formatDateTime(e.approvedAt)}{e.approvedBy ? ` by ${e.approvedBy.name}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Audit trail. Kept outside the "All Clear" branch on purpose: an empty
          queue is the normal state, and the decisions that produced it are the
          only record that they were ever made. */}
      <SectionCard title="Recent Verifications" description="The last 8 security walk-down decisions">
        {recent.length === 0 ? (
          <EmptyState icon={<Shield className="w-6 h-6 text-slate-400" />} title="No verifications yet" description="Approved and rejected parking checks will be listed here" />
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {recent.map(v => (
              <div key={v.id} className={`p-2.5 rounded-lg border text-xs ${v.status === 'APPROVED' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-start justify-between mb-0.5 gap-2">
                  <span className="font-medium text-slate-900">{v.machine?.serialNumber}</span>
                  <Badge variant={v.status === 'APPROVED' ? 'green' : 'red'}>{v.status}</Badge>
                </div>
                <p className="text-slate-600">{v.slot?.yard?.name ? `${v.slot.yard.name} — Slot ${slotLabel(v.slot.row, v.slot.col)}` : '—'}</p>
                <p className="text-slate-400">By {v.user?.name} · {formatDateTime(v.verifiedAt)}</p>
                {v.comments && v.comments !== 'Verified' && <p className="text-slate-500 mt-0.5 italic">“{v.comments}”</p>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

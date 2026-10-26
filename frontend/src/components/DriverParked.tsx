'use client';

import { useState, useEffect, useCallback } from 'react';
import Button from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { slotLabel, formatDateTime } from '@/lib/format';
import { authHeaders } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { isYardRecorder } from '@/lib/roles';
import { useRealtimeEvent } from '@/contexts/NotificationContext';
import { Truck, MapPin, CheckCircle2, XCircle, RefreshCw, History } from 'lucide-react';

interface Machine {
  id: string;
  serialNumber: string;
  model?: string;
  parkStatus: string;
  plannedSlotId?: string | null;
  currentSlot?: { id: string; yard: { name: string }; row: number; col: number } | null;
}

interface ParkingRecord {
  id: string;
  timestamp: string;
  notes?: string | null;
  machine?: { serialNumber: string };
  yard?: { name: string } | null;
  toSlot?: { row: number; col: number } | null;
  user?: { name: string; role?: string } | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const STATUS_HELP: Record<string, string> = {
  PLANNED: 'Not released for movement yet. Wait for the yard to assign you a slot.',
  READY_TO_MOVE: 'Released. Head to the gate for barcode check-in.',
  IN_TRANSIT: 'You are checked in at the gate. Drive to your assigned slot.',
  PARKED_PENDING: 'Confirmed parked. Security is checking it now.',
  PARKED_REJECTED: 'Security rejected this. Re-park in the same slot and confirm again.',
  PARKED_VERIFIED: 'Verified by security. Nothing more to do.'
};

export default function DriverParked() {
  const { user } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [recentParks, setRecentParks] = useState<ParkingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // This screen is also a driver's, and a driver must not see what every other
  // driver parked, so the shared trail is only fetched for the yard office roles.
  const canSeeParkingTrail = user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER' || user?.role === 'OPERATOR';

  // `mine=true` resolves the linked Driver record from the token server-side, so
  // the scoping cannot be bypassed by editing the query string.
  const fetchMine = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const params = new URLSearchParams({
        parkStatus: 'IN_TRANSIT,PARKED_PENDING,PARKED_REJECTED,PARKED_VERIFIED',
        mine: 'true'
      });
      const r = await fetch(`${API_URL}/api/machines?${params.toString()}`, { headers: authHeaders() });
      if (!r.ok) {
        setError(r.status === 401 ? 'Your session has expired. Sign in again.' : 'Could not load your machines.');
        return;
      }
      const data = await r.json();
      setMachines(Array.isArray(data) ? data : []);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMine(true); }, [fetchMine]);

  // The yard office can record a park on a driver's behalf, so this trail is what
  // answers "who actually confirmed this, and was it the driver or the office".
  const fetchRecentParks = useCallback(async () => {
    if (!canSeeParkingTrail) return;
    try {
      const r = await fetch(`${API_URL}/api/movements?reason=YARD_ENTRY&pageSize=8`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        setRecentParks(Array.isArray(data?.items) ? data.items : []);
      }
    } catch { /* the confirm list above still works without the trail */ }
  }, [canSeeParkingTrail]);

  useEffect(() => { fetchRecentParks(); }, [fetchRecentParks]);

  useRealtimeEvent('security-queue', () => { fetchMine(); fetchRecentParks(); });

  const confirmParked = async (m: Machine) => {
    if (busy) return;
    setBusy(m.id);
    setError(null);
    setDone(null);
    try {
      const r = await fetch(`${API_URL}/api/machines/${m.id}/parked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({})
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.error || 'Could not confirm parking. Please tell the yard office.');
        return;
      }
      setDone(
        body.autoVerified
          ? `Confirmed. ${m.serialNumber} is parked and verified.`
          : body.isRepark
            ? `Re-confirmed. ${m.serialNumber} is back with security.`
            : `Confirmed. ${m.serialNumber} is with security for checking.`
      );
      fetchMine();
      fetchRecentParks();
    } catch {
      setError('Could not reach the server. Nothing was saved, please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <PageSpinner />;

  const canConfirm = (m: Machine) => m.parkStatus === 'IN_TRANSIT' || m.parkStatus === 'PARKED_REJECTED';
  const active = machines.filter(m => m.parkStatus !== 'PARKED_VERIFIED');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Confirm Parking"
        description="Tell the yard when the machine is physically in its slot"
        actions={
          <Button variant="ghost" size="sm" onClick={() => fetchMine(true)} icon={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {done && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{done}</div>
      )}

      {machines.length === 0 ? (
        <SectionCard title="Nothing to do">
          <EmptyState icon={<Truck className="w-6 h-6 text-slate-400" />} title="No machines assigned" description="Nothing is currently waiting on you to park." />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {active.map(m => {
            const confirmable = canConfirm(m);
            const rejected = m.parkStatus === 'PARKED_REJECTED';
            const waiting = m.parkStatus === 'PARKED_PENDING';
            const slot = m.currentSlot;

            return (
              <div
                key={m.id}
                className={`rounded-lg border p-4 ${
                  rejected ? 'bg-red-50 border-red-200'
                  : waiting ? 'bg-amber-50 border-amber-200'
                  : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{m.serialNumber}</p>
                    {m.model && <p className="text-xs text-slate-500 mt-0.5">{m.model}</p>}
                    {slot ? (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-600">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        {slot.yard.name} — Slot {slotLabel(slot.row, slot.col)}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-500">No slot assigned yet</p>
                    )}
                  </div>

                  <Badge variant={rejected ? 'red' : waiting ? 'amber' : 'blue'} dot>
                    {m.parkStatus.replace(/_/g, ' ')}
                  </Badge>
                </div>

                <p className="mt-3 text-xs text-slate-600">{STATUS_HELP[m.parkStatus]}</p>

                {rejected && (
                  <p className="mt-2 rounded-md bg-white/70 px-3 py-2 text-xs text-red-700">
                    Put the machine back in this same slot, then confirm again.
                  </p>
                )}

                {confirmable && (
                  <div className="mt-3">
                    <Button
                      variant={rejected ? 'primary' : 'success'}
                      size="md"
                      className="w-full sm:w-auto"
                      onClick={() => confirmParked(m)}
                      disabled={busy === m.id}
                      loading={busy === m.id}
                      icon={<CheckCircle2 className="w-4 h-4" />}
                    >
                      I have parked it
                    </Button>
                  </div>
                )}

                {waiting && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-700">
                    <RefreshCw className="w-3.5 h-3.5" /> Waiting for security to check it
                  </p>
                )}
              </div>
            );
          })}

          {machines.some(m => m.parkStatus === 'PARKED_VERIFIED') && (
            <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <XCircle className="w-3.5 h-3.5" />
              {machines.filter(m => m.parkStatus === 'PARKED_VERIFIED').length} already verified by security
            </p>
          )}
        </div>
      )}

      {canSeeParkingTrail && (
        <SectionCard title="Recent Parking Activity" description="The last 8 parking confirmations across the yard">
          {recentParks.length === 0 ? (
            <EmptyState icon={<History className="w-6 h-6 text-slate-400" />} title="No parking activity yet" description="Confirmed parks will be listed here" />
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {recentParks.map(p => (
                <div key={p.id} className="p-2.5 rounded-lg border border-slate-200 bg-white text-xs">
                  <div className="flex items-start justify-between mb-0.5 gap-2">
                    <span className="font-medium text-slate-900">{p.machine?.serialNumber}</span>
                    <Badge variant="green">PARKED</Badge>
                  </div>
                  <p className="text-slate-600">{p.yard?.name ? `${p.yard.name} — Slot ${p.toSlot ? slotLabel(p.toSlot.row, p.toSlot.col) : '—'}` : '—'}</p>
                  <p className="text-slate-400">
                    Recorded by {p.user?.name} ({isYardRecorder(p.user?.role) ? 'Yard office' : 'Driver'}) · {formatDateTime(p.timestamp)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

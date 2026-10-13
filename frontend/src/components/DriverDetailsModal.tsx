'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { Barcode as BarcodeSvg, canEncodeCode128 } from '@/lib/barcode';
import { UserRound } from 'lucide-react';

export interface DriverDetails {
  id: string;
  name: string;
  phone?: string | null;
  licenseNo?: string | null;
  employeeCode?: string | null;
  photoUrl?: string | null;
  status: string;
  user?: { id: string; name: string; email: string; isActive: boolean } | null;
  _count?: { machines: number };
}

interface DriverDetailsModalProps {
  driverId: string | null;
  /** The driver row already present in the slot payload, shown instantly while the roster refetch resolves. */
  initialDriver: DriverDetails | null;
  onClose: () => void;
}

/**
 * Full driver view opened from the yard slot panel. The slot payload carries the
 * whole driver row, so the modal renders immediately; the one /api/drivers fetch
 * enriches it with the linked login and assigned-machine count. Keyed by driverId
 * in the caller so each new driver remounts cleanly.
 */
export default function DriverDetailsModal({ driverId, initialDriver, onClose }: DriverDetailsModalProps) {
  const [fetched, setFetched] = useState<DriverDetails | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failure, setFailure] = useState(false);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  useEffect(() => {
    if (!driverId) return;
    if (loadedFor === driverId) return;

    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem('token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_URL}/api/drivers`, { headers });
        const list = await res.json();
        if (cancelled) return;
        const found = Array.isArray(list) ? list.find((d: DriverDetails) => d.id === driverId) : null;
        setFetched(found ?? null);
        setFailure(false);
        setLoadedFor(driverId);
      } catch {
        if (cancelled) return;
        setFailure(true);
        setLoadedFor(driverId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [driverId, loadedFor, API_URL]);

  const driver = fetched ?? initialDriver;

  return (
    <Modal open={driverId !== null} onClose={onClose} size="sm" title="Driver Details" subtitle={driver?.name}>
      {driver ? (
        <div className="space-y-3.5">
          <div className="flex items-center gap-3">
            {driver.photoUrl
              ? <img src={`${API_URL}${driver.photoUrl}`} alt={driver.name} className="w-20 h-20 rounded-lg object-cover border border-slate-200" />
              : <div className="w-20 h-20 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400"><UserRound className="w-8 h-8" /></div>}
            <div className="min-w-0">
              <p className="text-base font-bold text-slate-900 leading-tight">{driver.name}</p>
              {driver.employeeCode
                ? <Badge variant="indigo" dot>{driver.employeeCode}</Badge>
                : <span className="text-xs text-slate-400 italic">No badge</span>}
            </div>
          </div>

          {driver.employeeCode && canEncodeCode128(driver.employeeCode) && (
            <div className="rounded-lg border border-slate-200 bg-white p-2.5 flex flex-col items-center">
              <BarcodeSvg code={driver.employeeCode} height={42} className="max-w-full" />
              <p className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-500">Gate badge barcode</p>
            </div>
          )}

          <dl className="text-xs space-y-1.5">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Employee code</dt><dd className="text-slate-800 font-medium text-right">{driver.employeeCode || '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Phone</dt><dd className="text-slate-800 text-right">{driver.phone || '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">License no</dt><dd className="text-slate-800 text-right">{driver.licenseNo || '—'}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Status</dt><dd className="text-right"><Badge variant={driver.status === 'AVAILABLE' ? 'green' : 'amber'} dot>{driver.status}</Badge></dd></div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Login</dt>
              <dd className="text-right">
                {driver.user
                  ? <Badge variant={driver.user.isActive ? 'indigo' : 'gray'} dot>{driver.user.email}</Badge>
                  : <span className="text-slate-400 italic">No login</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Assigned machines</dt><dd className="text-slate-800 font-medium text-right">{driver._count?.machines ?? '…'}</dd></div>
          </dl>
        </div>
      ) : (
        <div className="py-6 flex flex-col items-center gap-2.5">
          <PageSpinner />
          {failure && <p className="text-xs text-slate-500">Could not load driver details.</p>}
        </div>
      )}
    </Modal>
  );
}
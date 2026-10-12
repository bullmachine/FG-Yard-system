'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { AssemblyStageBadge, ParkStatusBadge } from '@/components/ui/StatusBadge';
import { PageSpinner } from '@/components/ui/Spinner';
import StageTimeline, { StageRow, StageSummary } from '@/components/StageTimeline';
import { AlertCircle } from 'lucide-react';

interface HistoryMachine {
  id: string;
  serialNumber: string;
  model: string;
  modelType?: string;
  barcode?: string;
  orderNo?: string;
  itemCode?: string;
  itemDescription?: string;
  assemblyStage: number;
  parkStatus: string;
  productionDate?: string;
  lastSyncAt?: string;
  isDemo?: boolean;
  currentSlot?: { row: number; col: number; yard?: { name: string } } | null;
}

interface HistoryResponse {
  machine: HistoryMachine;
  summary: StageSummary;
  stages: StageRow[];
}

interface StageHistoryModalProps {
  machineId: string | null;
  onClose: () => void;
}

export default function StageHistoryModal({ machineId, onClose }: StageHistoryModalProps) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  // Failures are tagged with the machine they belong to so switching machines
  // cannot surface another machine's error.
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  useEffect(() => {
    if (!machineId) return;

    let cancelled = false;

    // State is only updated from these async callbacks, never synchronously in
    // the effect body.
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/machines/${machineId}/history`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
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
  }, [machineId, API_URL]);

  const error = failure && machineId && failure.id === machineId ? failure.message : null;
  // A payload only counts once it belongs to the machine currently open.
  const current = data && machineId && data.machine?.id === machineId ? data : null;
  const loading = machineId !== null && error === null && current === null;
  const machine = current?.machine;
  const summary = current?.summary;
  const stages = current?.stages ?? [];

  return (
    <Modal
      open={machineId !== null}
      onClose={onClose}
      size="xl"
      title={machine ? `Stage History — ${machine.serialNumber}` : 'Stage History'}
      subtitle={machine?.orderNo ? `Order ${machine.orderNo}` : undefined}
    >
      {loading && <PageSpinner />}

      {!loading && error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-xs leading-relaxed">{error}</span>
        </div>
      )}

      {!loading && !error && current && machine && summary && (
        <div className="space-y-4">
          {/* Machine identity */}
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

          <StageTimeline summary={summary} stages={stages} />
        </div>
      )}
    </Modal>
  );
}

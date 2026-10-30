'use client';

import Badge from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/format';
import { plantStateMeta } from '@/lib/plantState';
import { CheckCircle2, CircleDashed, CircleDot, ClipboardCheck, Loader2, Info } from 'lucide-react';

/**
 * Presentational stage timeline, shared by every screen that shows assembly stage
 * history. It renders no data fetching of its own: the caller supplies the summary
 * and the stage rows, which keeps the Assembly Line page and the Machine Tracking
 * page showing the same timeline instead of two copies that can drift apart.
 */

export type StageStatus = 'COMPLETED' | 'IN_INSPECTION' | 'IN_PROGRESS' | 'NOT_STARTED';

export interface StageRow {
  stage: number;
  status: StageStatus;
  workCenter: string | null;
  startedAt: string | null;
  endedAt: string | null;
  completedQty: string | null;
  endState?: string | null;
  source: 'PLANT_SYNC' | 'MANUAL' | null;
  durationMinutes: number | null;
}

export interface StageSummary {
  totalStages: number;
  completedCount: number;
  recordedCount: number;
  currentStage: number;
  inProgressStage: number | null;
  inInspectionStages?: number[];
  hasHistory: boolean;
  lastRecordedAt: string | null;
}

/** Renders an operation duration from the minute count the API returns. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const statusMeta: Record<StageStatus, { icon: React.ReactNode; label: string; row: string; badge: string }> = {
  COMPLETED: {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
    label: 'Completed',
    row: 'bg-emerald-50/40',
    badge: 'bg-emerald-100 text-emerald-800'
  },
  IN_INSPECTION: {
    icon: <ClipboardCheck className="h-4 w-4 text-purple-600" />,
    label: 'In inspection',
    row: 'bg-purple-50/50',
    badge: 'bg-purple-100 text-purple-800'
  },
  IN_PROGRESS: {
    icon: <Loader2 className="h-4 w-4 text-amber-600" />,
    label: 'In progress',
    row: 'bg-amber-50/50',
    badge: 'bg-amber-100 text-amber-800'
  },
  NOT_STARTED: {
    icon: <CircleDashed className="h-4 w-4 text-slate-300" />,
    label: 'Not started',
    row: '',
    badge: 'bg-slate-100 text-slate-500'
  }
};

interface StageTimelineProps {
  summary: StageSummary;
  stages: StageRow[];
}

export default function StageTimeline({ summary, stages }: StageTimelineProps) {
  return (
    <div className="space-y-3">
      {/* Progress summary */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Progress</span>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-emerald-100 text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {summary.completedCount} of {summary.totalStages} completed
        </span>
        {summary.inProgressStage !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-amber-100 text-amber-800">
            <CircleDot className="h-3.5 w-3.5" />
            In progress at stage {summary.inProgressStage}
          </span>
        )}
        {summary.inInspectionStages && summary.inInspectionStages.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-purple-100 text-purple-800">
            <ClipboardCheck className="h-3.5 w-3.5" />
            In inspection at stage {summary.inInspectionStages.join(', ')}
          </span>
        )}
        {summary.lastRecordedAt && (
          <span className="text-[11px] text-slate-500">
            Last recorded {formatDateTime(summary.lastRecordedAt)}
          </span>
        )}
      </div>

      {!summary.hasHistory && (
        <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="text-xs leading-relaxed">
            No stage history recorded for this machine yet. History is captured during production
            sync, so run a sync while this machine is inside the sync window to populate it.
          </span>
        </div>
      )}

      {/* Timeline */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Stage', 'Status', 'Plant Status', 'Work Centre', 'Started', 'Ended', 'Duration', 'Source'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {stages.map((s) => {
              const meta = statusMeta[s.status];
              const duration = formatDuration(s.durationMinutes);
              const plant = plantStateMeta(s.endState);
              return (
                <tr key={s.stage} className={meta.row}>
                  <td className="px-3 py-2 text-[13px] font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    {s.stage}
                  </td>
                  <td className="px-3 py-2 text-[13px] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {meta.icon}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                    {plant ? <Badge variant={plant.variant}>{plant.label}</Badge> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[12px] font-mono text-slate-600 whitespace-nowrap">
                    {s.workCenter || '—'}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">
                    {s.startedAt ? formatDateTime(s.startedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-600 whitespace-nowrap">
                    {s.endedAt ? formatDateTime(s.endedAt) : (s.status === 'IN_PROGRESS' ? 'in progress' : '—')}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-600 tabular-nums whitespace-nowrap">
                    {duration || '—'}
                  </td>
                  <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                    {s.source === 'MANUAL' ? (
                      <Badge>Manual</Badge>
                    ) : s.source === 'PLANT_SYNC' ? (
                      <span className="text-[11px] text-slate-400">Plant</span>
                    ) : (
                      <span className="text-[11px] text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

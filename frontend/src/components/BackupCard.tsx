'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, DatabaseBackup, FolderOpen } from 'lucide-react';
import Button from '@/components/ui/Button';
import { SectionCard } from '@/components/ui/Card';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface BackupFile { name: string; size: number; modifiedAt: string }
interface BackupStatus {
  dir: string;
  cron: string;
  keepDays: number;
  running: boolean;
  last: { ok: boolean; finishedAt: string; file?: string; size?: number; error?: string; trigger: string } | null;
  files: BackupFile[];
}

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Settings > Database Backup: where the nightly backup goes, the last result, and a Back up now button. */
export default function BackupCard() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/backups`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setStatus(d); })
      .catch(() => undefined); // The card shows "loading" until the server answers.
    return () => { live = false; };
  }, []);

  const runNow = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/backups/run`, { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => null);
      if (body?.status) setStatus(body.status);
      if (!res.ok) setError(body?.error || `Backup failed (${res.status})`);
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const last = status?.last;
  const newest = status?.files[0];

  return (
    <SectionCard
      title="Database Backup"
      description="The whole database is saved every night into a folder on this server. The Admin team copies the files from that folder to another system."
      action={<Button size="sm" variant="secondary" onClick={runNow} loading={busy} icon={<DatabaseBackup className="w-3.5 h-3.5" />}>Back up now</Button>}
    >
      {!status ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 sm:col-span-3">
              <p className="flex items-center gap-1.5 font-semibold text-slate-700"><FolderOpen className="h-3.5 w-3.5" /> Folder</p>
              <code className="mt-0.5 block break-all text-[11px] text-slate-800">{status.dir}</code>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-slate-500">Schedule</p>
              <p className="font-semibold text-slate-800">{status.cron === '0 1 * * *' ? 'Every night at 01:00' : <code>{status.cron}</code>}</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-slate-500">Kept for</p>
              <p className="font-semibold text-slate-800">{status.keepDays} days (newest 3 always kept)</p>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2">
              <p className="text-slate-500">Latest file</p>
              <p className="font-semibold text-slate-800">{newest ? `${formatDateTime(newest.modifiedAt)} · ${size(newest.size)}` : 'None yet'}</p>
            </div>
          </div>

          {last && (
            last.ok ? (
              <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
                Last backup ({last.trigger === 'scheduled' ? 'scheduled' : 'manual'}) finished {formatDateTime(last.finishedAt)}: {last.file}, {size(last.size ?? 0)}.
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                Last backup failed {formatDateTime(last.finishedAt)}: {last.error}
              </p>
            )
          )}
          {error && !last && <p className="text-xs font-medium text-red-700">{error}</p>}

          {status.files.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-slate-600">{status.files.length} file{status.files.length === 1 ? '' : 's'} in the folder</summary>
              <ul className="mt-1.5 divide-y divide-slate-100 rounded-md border border-slate-200">
                {status.files.map((f) => (
                  <li key={f.name} className="flex justify-between gap-3 px-3 py-1.5">
                    <code className="truncate text-[11px]">{f.name}</code>
                    <span className="shrink-0 tabular-nums text-slate-500">{size(f.size)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500">
            The folder, time and days kept are set in backend/.env (BACKUP_DIR, BACKUP_CRON, BACKUP_KEEP_DAYS); see INSTALL.md.
            A failed backup notifies every Admin. Files contain personal data: share the folder with the Admin team only.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

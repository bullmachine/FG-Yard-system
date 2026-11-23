'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

/**
 * Re-read one machine from the plant system by its order number (stage, stage
 * history, barcode), without waiting for the next full sync. Used in the Assembly
 * Line and Machine Tracking lists.
 */
export default function PlantUpdateButton({ orderNo, onDone }: {
  orderNo: string;
  onDone: (result: { ok: boolean; message: string }) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (e: React.MouseEvent) => {
    // The list rows open a details window on click; this button must not.
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const t = localStorage.getItem('token');
      const r = await fetch(`${API_URL}/api/assembly/refresh-from-plant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ orderNo })
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) onDone({ ok: false, message: d?.error || `Update failed (${r.status})` });
      else onDone({ ok: d?.found === true, message: d?.message || 'Updated' });
    } catch {
      onDone({ ok: false, message: 'Could not reach the server' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={`Update order ${orderNo} from the plant system now`}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Updating…' : 'Update'}
    </button>
  );
}

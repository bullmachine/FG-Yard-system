'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, XCircle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { API_URL, authHeaders } from '@/lib/api';
import { excelDate, readSheet } from '@/lib/sheet';

interface Row { serial: string; yard: string; slot: string; inwardDate?: string; remark?: string }
interface Result extends Row { line: number; ok: boolean; error?: string }

const TEMPLATE = 'Serial Number,Yard,Slot,Inward Date,Remark\r\n';

/** Header text -> field. Matches loosely so a planner's own sheet usually works as is. */
function fieldOf(header: string): keyof Row | null {
  const h = header.toLowerCase();
  if (/serial|barcode|machine/.test(h)) return 'serial';
  if (/yard/.test(h)) return 'yard';
  if (/slot|location/.test(h)) return 'slot';
  if (/date|inward/.test(h)) return 'inwardDate';
  if (/remark|note|comment/.test(h)) return 'remark';
  return null;
}

function toRows(table: string[][]): Row[] {
  const [header = [], ...body] = table;
  const map = header.map(fieldOf);
  if (!map.includes('serial') || !map.includes('yard') || !map.includes('slot')) {
    throw new Error('The first row must have the column names: Serial Number, Yard, Slot (Inward Date and Remark are optional). Download the template.');
  }
  return body
    .filter((cells) => cells.some((c) => c?.trim()))
    .map((cells) => {
      const r: Row = { serial: '', yard: '', slot: '' };
      map.forEach((f, i) => { if (f) r[f] = (cells[i] ?? '').trim(); });
      if (r.inwardDate) r.inwardDate = excelDate(r.inwardDate);
      return r;
    });
}

/**
 * Machine Tracking > Upload stock list (initial stock load only). Reads the Excel or
 * CSV file here, the server checks every row, then places the rows that passed.
 */
export default function StockUploadModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setFileName(''); setRows([]); setResults(null); setPlaced(null); setError(''); };
  const close = () => { reset(); onClose(); };

  const post = async (body: { rows: Row[]; commit?: boolean }) => {
    const res = await fetch(`${API_URL}/api/machines/bulk-allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);
    return data as { results: Result[]; placed?: number };
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const parsed = toRows(await readSheet(file));
      if (parsed.length === 0) throw new Error('The file has no machine rows under the header');
      setRows(parsed);
      setResults((await post({ rows: parsed })).results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const place = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await post({ rows, commit: true });
      setResults(data.results);
      setPlaced(data.placed ?? 0);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the machines');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fg-yard-stock-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const good = results?.filter((r) => r.ok).length ?? 0;
  const bad = (results?.length ?? 0) - good;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload Stock List"
      subtitle="Initial stock load: machines already parked in the yard, from Excel or CSV"
      size="xl"
      footer={placed !== null ? (
        <Button onClick={close}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={place} loading={busy && rows.length > 0 && !!results} disabled={!results || good === 0 || busy}>
            {good > 0 ? `Place ${good} machine${good === 1 ? '' : 's'}` : 'Place machines'}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <p>One machine per row. Columns: <b>Serial Number</b> (or barcode), <b>Yard</b> (name as in FG Yard), <b>Slot</b> (as on the yard map, e.g. B7),
            optional <b>Inward Date</b> (e.g. 15-08-2026) and <b>Remark</b>. At most 500 rows.</p>
          <p className="mt-1">Each machine needs Stage 18 and a barcode, the slot must be free, and every placement still goes to Security for verification.
            Rows with a problem are skipped; fix them and upload again.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
          <Button variant="secondary" onClick={() => input.current?.click()} loading={busy && !results} icon={<FileSpreadsheet className="h-4 w-4" />} disabled={placed !== null}>
            {fileName ? 'Choose another file' : 'Choose file'}
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadTemplate} icon={<Download className="h-3.5 w-3.5" />}>Template</Button>
          {fileName && <span className="truncate text-xs text-slate-500">{fileName}</span>}
        </div>

        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{error}</p>}

        {placed !== null && (
          <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> {placed} machine{placed === 1 ? '' : 's'} placed and sent to Security for verification.
            {bad > 0 && ` ${bad} row${bad === 1 ? '' : 's'} skipped (see below).`}
          </p>
        )}

        {results && (
          <>
            <div className="flex gap-3 text-xs">
              <span className="font-semibold text-emerald-700">{good} ready</span>
              <span className={`font-semibold ${bad ? 'text-red-700' : 'text-slate-400'}`}>{bad} with a problem</span>
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2.5 py-1.5 font-semibold">Line</th>
                    <th className="px-2.5 py-1.5 font-semibold">Serial</th>
                    <th className="px-2.5 py-1.5 font-semibold">Yard</th>
                    <th className="px-2.5 py-1.5 font-semibold">Slot</th>
                    <th className="px-2.5 py-1.5 font-semibold">Inward</th>
                    <th className="px-2.5 py-1.5 font-semibold">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...results].sort((a, b) => Number(a.ok) - Number(b.ok) || a.line - b.line).map((r) => (
                    <tr key={r.line} className={r.ok ? '' : 'bg-red-50/50'}>
                      <td className="px-2.5 py-1.5 tabular-nums text-slate-400">{r.line}</td>
                      <td className="px-2.5 py-1.5 font-medium text-slate-800">{r.serial || '—'}</td>
                      <td className="px-2.5 py-1.5">{r.yard || '—'}</td>
                      <td className="px-2.5 py-1.5">{r.slot || '—'}</td>
                      <td className="px-2.5 py-1.5 tabular-nums">{r.inwardDate || '—'}</td>
                      <td className="px-2.5 py-1.5">
                        {r.ok
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{placed !== null ? 'Placed' : 'Ready'}</span>
                          : <span className="inline-flex items-start gap-1 text-red-700"><XCircle className="mt-px h-3.5 w-3.5 shrink-0" />{r.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

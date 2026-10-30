'use client';

import { useEffect, useState } from 'react';
import Badge from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateShort, formatDateTime } from '@/lib/format';
import { AlertCircle, Info } from 'lucide-react';

interface MachineSap {
  checkedAt: string | null;
  stock: { storageLoc: string | null; matGroup: string | null; confDate: string | null; material: string } | null;
  documents: { invoice: string; deliveryDate: string; material: string; description: string | null; cutRow: boolean }[];
}

/** Machine history › SAP: is it in SAP FG stock now, and the SAP invoices that list it. */
export default function MachineSapPanel({ serialNumber }: { serialNumber: string }) {
  const [data, setData] = useState<MachineSap | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/sap-check/machine/${encodeURIComponent(serialNumber)}`, { headers: authHeaders() })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (r.ok) setData(body);
        else setError(body?.error || `Could not load SAP details (${r.status})`);
      })
      .catch(() => { if (live) setError('Could not reach the server'); });
    return () => { live = false; };
  }, [serialNumber]);

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!data) return <PageSpinner />;
  if (!data.checkedAt) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> SAP has not been checked yet. See the SAP Check page.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-500">SAP FG stock</span>
        {data.stock ? (
          <>
            <Badge variant="green" dot>In SAP stock</Badge>
            <span>SLoc {data.stock.storageLoc || '—'}</span>
            {data.stock.matGroup && <Badge variant={data.stock.matGroup === 'EXPORT' ? 'indigo' : 'gray'}>{data.stock.matGroup === 'EXPORT' ? 'Export' : 'Domestic'}</Badge>}
            <span>Confirmed {data.stock.confDate ? formatDateShort(data.stock.confDate) : '—'}</span>
          </>
        ) : (
          <Badge variant="gray">Not in SAP stock</Badge>
        )}
        <span className="text-slate-400">as of {formatDateTime(data.checkedAt)}</span>
      </div>

      {data.documents.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          No SAP invoice lists this machine.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableHeaderCell>Invoice</TableHeaderCell>
            <TableHeaderCell>Delivery Date</TableHeaderCell>
            <TableHeaderCell>Material</TableHeaderCell>
          </TableHeader>
          <TableBody>
            {data.documents.map((d) => (
              <TableRow key={d.invoice}>
                <TableCell><span className="font-mono text-xs text-slate-800">{d.invoice}</span></TableCell>
                <TableCell className="text-xs text-slate-600">{formatDateShort(d.deliveryDate)}</TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-slate-700">{d.material}</span>
                  {d.description && <span className="ml-1.5 text-[11px] text-slate-500">{d.description}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-[11px] text-slate-400">
        SAP sends several document types (for example 1420, 1421, 1422, 1460). Ask Accounts which one is the sales invoice when they differ.
      </p>
    </div>
  );
}

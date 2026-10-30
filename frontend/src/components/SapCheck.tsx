'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { SectionCard, StatCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { ParkStatusBadge } from '@/components/ui/StatusBadge';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateShort, formatDateTime } from '@/lib/format';
import { AlertTriangle, Download, FileWarning, LogOut, PackageSearch, RefreshCw, Search, Truck, Wrench, X } from 'lucide-react';

type GroupKey = 'invoicedNotClosed' | 'leftNoInvoice' | 'yardNotInStock' | 'stockInAssembly' | 'stockNoRecord' | 'stockAwaitingGate';

interface SapRow {
  serialNumber: string;
  model: string | null;
  material: string | null;
  fgStatus: string | null;
  location: string | null;
  storageLoc: string | null;
  matGroup: string | null;
  confDate: string | null;
  invoice: string | null;
  deliveryDate: string | null;
  mainGateOutAt: string | null;
  note: string | null;
}

interface SapStatus {
  running: boolean;
  cron: string;
  graceDays: number;
  last: { ok: boolean; startedAt: string; finishedAt: string | null; trigger: string; error: string | null } | null;
  lastOkAt: string | null;
  coverageFrom: string | null;
  stockCount: number;
  deliveryCount: number;
  cutInvoices: number;
}

interface SapReport {
  status: SapStatus;
  groups: Record<GroupKey, SapRow[]> | null;
}

// Order on the page: things to act on first, the normal queue to the gate last.
const GROUPS: { key: GroupKey; label: string; hint: string; icon: React.ReactNode; color: 'red' | 'amber' | 'purple' | 'indigo' | 'slate' | 'blue'; mismatch: boolean }[] = [
  { key: 'invoicedNotClosed', label: 'Invoiced, still in FG Yard', hint: 'SAP has invoiced it and it is out of SAP stock, but FG Yard still shows it here. Gate it out, or check the gate records.', icon: <FileWarning />, color: 'red', mismatch: true },
  { key: 'leftNoInvoice', label: 'Main gate out, no invoice', hint: 'Left through the main gate, but SAP has no delivery document for it. Check with Logistics / Accounts.', icon: <LogOut />, color: 'red', mismatch: true },
  { key: 'yardNotInStock', label: 'In FG Yard, not in SAP', hint: 'Parked or on the way into the yard, but not in SAP FG stock and not invoiced. Check the SAP goods receipt.', icon: <AlertTriangle />, color: 'amber', mismatch: true },
  { key: 'stockInAssembly', label: 'SAP stock, still in assembly', hint: 'SAP holds it as FG stock, while the plant line still shows a stage open (often stage 18 in inspection).', icon: <Wrench />, color: 'purple', mismatch: true },
  { key: 'stockNoRecord', label: 'SAP stock, not in FG Yard', hint: 'SAP holds it as FG stock but FG Yard has no record: usually stock parked before go-live. Load it with Upload Stock List.', icon: <PackageSearch />, color: 'indigo', mismatch: true },
  { key: 'stockAwaitingGate', label: 'Waiting for the FG gate', hint: 'In SAP stock and ready to move. Normal: these come in at the gate next.', icon: <Truck />, color: 'slate', mismatch: false },
];

const STATUS_TEXT: Record<string, string> = {
  PLANNED: 'Planned', READY_TO_MOVE: 'Ready to Move', IN_TRANSIT: 'In Transit', AT_GATE: 'At Gate',
  PARKED_PENDING: 'Parked (pending)', PARKED_REJECTED: 'Parked (rejected)', PARKED_VERIFIED: 'Parked', EXITED: 'Exited',
};

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function downloadCsv(name: string, rows: { group: string; row: SapRow }[]) {
  const head = ['Group', 'Serial Number', 'Model / Description', 'Material', 'FG Yard Status', 'Location', 'Storage Loc', 'Export / Domestic', 'Conf Date', 'Invoice', 'Delivery Date', 'Main Gate Out', 'Note'];
  const lines = rows.map(({ group, row: r }) => [
    group, r.serialNumber, r.model, r.material, r.fgStatus ? STATUS_TEXT[r.fgStatus] ?? r.fgStatus : 'No record', r.location,
    r.storageLoc, r.matGroup, formatDateShort(r.confDate), r.invoice, formatDateShort(r.deliveryDate), formatDateTime(r.mainGateOutAt), r.note,
  ].map(csvCell).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** SAP Check: SAP FG stock and invoices compared with FG Yard. Report only; it changes nothing. */
export default function SapCheck() {
  const { can } = useAuth();
  const [report, setReport] = useState<SapReport | null>(null);
  const [loadError, setLoadError] = useState('');
  const [group, setGroup] = useState<GroupKey>('invoicedNotClosed');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/sap-check`, { headers: authHeaders() })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (r.ok) setReport(body);
        else setLoadError(body?.error || `Could not load the SAP check (${r.status})`);
      })
      .catch(() => { if (live) setLoadError('Could not reach the server'); });
    return () => { live = false; };
  }, []);

  const reload = async () => {
    const r = await fetch(`${API_URL}/api/sap-check`, { headers: authHeaders() });
    if (r.ok) setReport(await r.json());
  };

  const runNow = async () => {
    setRunning(true);
    setNotice(null);
    try {
      const r = await fetch(`${API_URL}/api/sap-check/run`, { method: 'POST', headers: authHeaders() });
      const body = await r.json().catch(() => null);
      if (r.ok) {
        setNotice({ ok: true, text: `SAP checked: ${body.stockRows} machines in SAP FG stock, ${body.deliveryRows} invoice lines read.` });
        await reload();
      } else {
        setNotice({ ok: false, text: body?.error || `SAP check failed (${r.status})` });
      }
    } catch {
      setNotice({ ok: false, text: 'Could not reach the server' });
    } finally {
      setRunning(false);
    }
  };

  const rows = useMemo(() => {
    const list = report?.groups?.[group] ?? [];
    const term = search.trim().toUpperCase();
    if (!term) return list;
    return list.filter((r) => [r.serialNumber, r.model, r.material, r.invoice, r.location].some((v) => v?.toUpperCase().includes(term)));
  }, [report, group, search]);

  if (!report && !loadError) return <PageSpinner />;

  const status = report?.status;
  const groups = report?.groups;
  const meta = GROUPS.find((g) => g.key === group)!;
  const mismatches = groups ? GROUPS.filter((g) => g.mismatch).reduce((n, g) => n + groups[g.key].length, 0) : 0;
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const shown = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const showInvoice = group === 'invoicedNotClosed';
  const showGateOut = group === 'leftNoInvoice';
  const showSap = group.startsWith('stock');

  return (
    <div className="space-y-3">
      <PageHeader
        title="SAP Check"
        description="SAP FG stock and invoices compared with FG Yard. A report only: nothing is blocked or changed."
        actions={can('sap.sync') ? (
          <Button variant="secondary" onClick={runNow} loading={running} icon={<RefreshCw className="w-4 h-4" />}>Check SAP now</Button>
        ) : undefined}
      />

      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>}
      {notice && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${notice.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{notice.text}</div>
      )}

      {status && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span>Last checked <b className="text-slate-800">{status.lastOkAt ? formatDateTime(status.lastOkAt) : 'never'}</b></span>
          <span>SAP FG stock <b className="text-slate-800">{status.stockCount}</b></span>
          <span>Invoices from <b className="text-slate-800">{status.coverageFrom ? formatDateShort(status.coverageFrom) : '—'}</b> ({status.deliveryCount} machine lines)</span>
          <span>{status.cron === '20 */2 * * *' ? 'Checks every 2 hours' : <>Schedule <code>{status.cron}</code></>}</span>
          {status.last && !status.last.ok && status.last.finishedAt && (
            <span className="text-red-700">Last attempt failed {formatDateTime(status.last.finishedAt)}: {status.last.error}</span>
          )}
          {status.cutInvoices > 0 && (
            <span className="text-amber-700" title="SAP cuts the serial list of an invoice line at 132 characters. Machines after the cut are not listed, so they can show as 'Main gate out, no invoice'.">
              {status.cutInvoices} SAP invoice(s) with a cut-off serial list
            </span>
          )}
        </div>
      )}

      {!groups ? (
        <SectionCard title="No SAP data yet">
          <EmptyState
            title="SAP has not been checked yet"
            description="The first check reads invoices from 1 April and the current SAP FG stock. It runs every 2 hours, or now with Check SAP now."
            action={can('sap.sync') ? <Button size="sm" onClick={runNow} loading={running} icon={<RefreshCw className="w-4 h-4" />}>Check SAP now</Button> : undefined}
          />
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {GROUPS.map((g) => (
              <StatCard key={g.key} label={g.label} value={groups[g.key].length} icon={g.icon} color={g.color} hint={g.hint}
                active={group === g.key} onClick={() => { setGroup(g.key); setPage(1); }} />
            ))}
          </div>

          <SectionCard
            title={`${meta.label} (${groups[group].length})`}
            description={meta.hint}
            bodyClassName="p-0"
            action={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Serial, model, invoice"
                    className="h-8 w-44 rounded-lg border border-slate-200 pl-7 pr-7 text-xs focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => downloadCsv(`sap-check-${meta.key}.csv`, rows.map((row) => ({ group: meta.label, row })))}>This list</Button>
                <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} title={`All ${mismatches} mismatches in one file`}
                  onClick={() => downloadCsv('sap-check-all.csv', GROUPS.filter((g) => g.mismatch).flatMap((g) => groups[g.key].map((row) => ({ group: g.label, row }))))}>All</Button>
              </div>
            }
          >
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">{search ? `Nothing matches "${search.trim()}"` : 'Nothing here. FG Yard and SAP agree.'}</p>
            ) : (
              <div>
                <Table>
                  <TableHeader>
                    <TableHeaderCell>Serial Number</TableHeaderCell>
                    <TableHeaderCell>Model / Description</TableHeaderCell>
                    <TableHeaderCell>FG Yard</TableHeaderCell>
                    {showSap && <TableHeaderCell>SAP Stock</TableHeaderCell>}
                    {showInvoice && <TableHeaderCell>Invoice</TableHeaderCell>}
                    {showGateOut && <TableHeaderCell>Main Gate Out</TableHeaderCell>}
                    {showGateOut && <TableHeaderCell>Note</TableHeaderCell>}
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.serialNumber}>
                        <TableCell>
                          <span className="font-medium text-slate-900">{r.serialNumber}</span>
                          {r.material && <span className="block font-mono text-[10px] text-slate-400">{r.material}</span>}
                        </TableCell>
                        <TableCell><span className="text-xs text-slate-700">{r.model || '—'}</span></TableCell>
                        <TableCell>
                          {r.fgStatus ? <ParkStatusBadge status={r.fgStatus} /> : <Badge variant="gray">No record</Badge>}
                          {r.location && <span className="mt-0.5 block text-[11px] text-slate-500">{r.location}</span>}
                        </TableCell>
                        {showSap && (
                          <TableCell>
                            <span className="text-xs text-slate-700">SLoc {r.storageLoc || '—'}</span>
                            {r.matGroup && <span className="ml-1.5"><Badge variant={r.matGroup === 'EXPORT' ? 'indigo' : 'gray'}>{r.matGroup === 'EXPORT' ? 'Export' : 'Domestic'}</Badge></span>}
                            <span className="block text-[11px] text-slate-500">Confirmed {r.confDate ? formatDateShort(r.confDate) : '—'}</span>
                          </TableCell>
                        )}
                        {showInvoice && (
                          <TableCell>
                            <span className="font-mono text-xs text-slate-800">{r.invoice}</span>
                            <span className="block text-[11px] text-slate-500">{formatDateShort(r.deliveryDate)}</span>
                          </TableCell>
                        )}
                        {showGateOut && <TableCell><span className="text-xs text-slate-700">{formatDateTime(r.mainGateOutAt)}</span></TableCell>}
                        {showGateOut && <TableCell><span className="text-[11px] text-amber-700">{r.note || '—'}</span></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Pagination total={rows.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

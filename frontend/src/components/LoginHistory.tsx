'use client';

import { useCallback, useEffect, useState } from 'react';
import { LogIn, RefreshCw, Search, ShieldAlert, UserCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface LoginEvent {
  id: string;
  event: 'LOGIN' | 'LOGOUT';
  result: 'SUCCESS' | 'WRONG_PASSWORD' | 'UNKNOWN_USER' | 'INACTIVE';
  email: string;
  ip: string;
  device: string;
  userAgent: string;
  createdAt: string;
  user: { name: string; role: string } | null;
}

interface HistoryResponse {
  items: LoginEvent[];
  total: number;
  retentionDays: number;
  today: { success: number; failed: number; users: number };
}

type ResultFilter = '' | 'SUCCESS' | 'FAILED' | 'LOGOUT';

const FILTERS: { value: ResultFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'SUCCESS', label: 'Signed in' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'LOGOUT', label: 'Signed out' },
];

function outcome(e: LoginEvent): { label: string; variant: 'green' | 'red' | 'amber' | 'gray' } {
  if (e.event === 'LOGOUT') return { label: 'Signed out', variant: 'gray' };
  switch (e.result) {
    case 'SUCCESS': return { label: 'Signed in', variant: 'green' };
    case 'WRONG_PASSWORD': return { label: 'Wrong password', variant: 'red' };
    case 'UNKNOWN_USER': return { label: 'Unknown account', variant: 'red' };
    default: return { label: 'Inactive account', variant: 'amber' };
  }
}

/** Administration > Login History: sign-ins, failures and sign-outs with IP and device. */
export default function LoginHistory() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [filter, setFilter] = useState<ResultFilter>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const t = setTimeout(() => { setQuery(next); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, query]);

  const load = useCallback((isCurrent: () => boolean = () => true) => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filter) qs.set('result', filter);
    if (query) qs.set('q', query);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return fetch(`${API_URL}/api/login-history?${qs}`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || `Load failed (${r.status})`);
        if (isCurrent()) { setData(d); setError(null); }
      })
      .catch((e: Error) => { if (isCurrent()) setError(e.message); })
      .finally(() => { if (isCurrent()) setLoading(false); });
  }, [page, pageSize, filter, query, from, to]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  if (loading) return <PageSpinner />;

  const showFailed = () => { setFilter('FAILED'); setPage(1); };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Login History"
        description={`Sign-ins, failed attempts and sign-outs with IP address and device. Kept ${data?.retentionDays ?? 90} days.`}
        actions={<Button variant="ghost" onClick={() => load()} icon={<RefreshCw className="w-4 h-4" />}>Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <StatCard label="Sign-ins today" value={data.today.success} icon={<LogIn className="w-4 h-4" />} color="green" hint="Successful" onClick={() => { setFilter('SUCCESS'); setPage(1); }} />
          <StatCard label="Users today" value={data.today.users} icon={<UserCheck className="w-4 h-4" />} color="blue" hint="Different accounts" />
          <StatCard label="Failed today" value={data.today.failed} icon={<ShieldAlert className="w-4 h-4" />} color={data.today.failed ? 'red' : 'slate'} hint="Wrong password, unknown or inactive" onClick={showFailed} />
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => { setFilter(f.value); setPage(1); }}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${filter === f.value ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:opacity-80'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <div className="w-full sm:w-56">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Email, name or IP…" icon={<Search className="w-3.5 h-3.5" />} aria-label="Search login history" />
            </div>
            <div className="w-36"><Input type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" title="From" /></div>
            <span className="text-xs text-slate-400">to</span>
            <div className="w-36"><Input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" title="To" /></div>
          </div>
        </div>

        {!data || data.items.length === 0 ? (
          <EmptyState icon={<LogIn className="w-6 h-6 text-slate-400" />} title="No sign-ins here" description="Sign-ins appear here as users log in" />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>User</TableHeaderCell>
                <TableHeaderCell>Result</TableHeaderCell>
                <TableHeaderCell>IP address</TableHeaderCell>
                <TableHeaderCell>Device</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => {
                  const o = outcome(e);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-[13px] tabular-nums">{formatDateTime(e.createdAt)}</TableCell>
                      <TableCell>
                        <span className="font-medium text-slate-900">{e.user?.name ?? '—'}</span>
                        <span className="block text-[11px] text-slate-500">{e.email}</span>
                      </TableCell>
                      <TableCell><Badge variant={o.variant}>{o.label}</Badge></TableCell>
                      <TableCell>
                        <button type="button" onClick={() => setSearch(e.ip)} className="font-mono text-xs text-blue-700 hover:underline" title="Show every sign-in from this IP">
                          {e.ip || '—'}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600" ><span title={e.userAgent}>{e.device}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination total={data.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizes={[50, 100]} />
          </>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        IP addresses linked to named users are personal data (DPDPA). Only Administrators can see this page, and
        history older than {data?.retentionDays ?? 90} days is deleted automatically. Five failed sign-ins on one account
        within 15 minutes send an alert to the Administrators.
      </p>
    </div>
  );
}

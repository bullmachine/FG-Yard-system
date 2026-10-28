'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { SectionCard, StatCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatDateTime } from '@/lib/format';
import { RefreshCw, Package, CalendarDays, Factory, Clock } from 'lucide-react';

interface MaterialMaster { id: string; material: string; plant: string; confMaterial: string; syncedAt: string; }
interface MaterialMasterStatus { lastSyncedAt: string | null; totalRecords: number; apiUrl: string; plant: string; dateRange: { fromDt: string; toDt: string }; }

interface SyncNotice { type: 'success' | 'error'; message: string; }

export default function MaterialMasters() {
  const [materials, setMaterials] = useState<MaterialMaster[]>([]);
  const [status, setStatus] = useState<MaterialMasterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const { isAuthenticated, can } = useAuth();
  const isAdmin = isAuthenticated && can('materials.sync');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchData = async () => {
    try {
      const [m, s] = await Promise.all([
        fetch(`${API_URL}/api/material-masters`, { headers: headers() }),
        fetch(`${API_URL}/api/material-masters/sync/status`, { headers: headers() })
      ]);
      if (m.ok) setMaterials(await m.json());
      if (s.ok) setStatus(await s.json());
    } catch { } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/material-masters/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: '{}' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setNotice({ type: 'error', message: `Sync failed (${res.status}): ${errBody?.error || res.statusText}` });
      } else {
        const result = await res.json();
        if (result?.errors?.length) {
          setNotice({ type: 'error', message: `Sync completed with ${result.errors.length} error(s): ${result.errors[0]}` });
        } else {
          const parts = [`${result.created || 0} created, ${result.updated || 0} updated (${result.totalRecords || 0} records)`];

          // Report the KMAT registration pass. Without this the Vehicle Model Master
          // list appears to grow on its own, with no indication of which rows still
          // need a real type and preferred yard.
          const kmats = result.kmats;
          if (kmats) {
            if (kmats.kmatsCreated > 0) {
              parts.push(`${kmats.kmatsCreated} KMAT row(s) added to Vehicle Model Master`);
            } else if (kmats.kmatsExisting > 0) {
              parts.push(`all ${kmats.kmatsExisting} KMAT(s) already registered`);
            }
            const skipped = kmats.kmatsSkippedEmpty + kmats.kmatsSkippedNotAKmat;
            if (skipped > 0) {
              parts.push(`${skipped} value(s) skipped (${kmats.kmatsSkippedEmpty} empty, ${kmats.kmatsSkippedNotAKmat} material codes)`);
            }
            if (kmats.kmatsCreated > 0) {
              parts.push('set type and preferred yard in Vehicle Model Master');
            }
          }

          setNotice({ type: 'success', message: `Sync complete: ${parts.join(' - ')}` });
        }
        await fetchData();
      }
    } catch (e) {
      setNotice({ type: 'error', message: `Sync request failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <PageSpinner />;

  const totalPages = Math.max(1, Math.ceil(materials.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = materials.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Material Master"
        description="SAP FERT_API — item code to CONF_MATERIAL mapping"
        actions={isAdmin ? <Button variant="secondary" icon={<RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />} onClick={handleSync} loading={syncing}>Sync Now</Button> : undefined}
      />

      {notice && (
        <div className={`px-4 py-3 rounded-lg border text-sm ${notice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {notice.message}
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard label="Synced Records" value={status.totalRecords} icon={<Package className="w-4 h-4" />} color="blue" />
          <StatCard label="Last Sync" value={status.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : 'Never'} icon={<Clock className="w-4 h-4" />} color="slate" />
          <StatCard label="Plant" value={status.plant} icon={<Factory className="w-4 h-4" />} color="indigo" />
          <StatCard label="Sync Window" value={`${status.dateRange?.fromDt ?? '—'} → ${status.dateRange?.toDt ?? '—'}`} icon={<CalendarDays className="w-4 h-4" />} color="amber" />
        </div>
      )}

      <SectionCard title={`Materials (${materials.length})`} description="CONF_MATERIAL must exist as KMAT in the Vehicle Model Master" bodyClassName={paginated.length === 0 ? '' : 'p-0'}>
        {materials.length === 0 ? (
          <EmptyState title="No material records" description="Run Sync Now to pull FERT material data from the SAP API" action={isAdmin ? <Button size="sm" onClick={handleSync} loading={syncing} icon={<RefreshCw className="w-4 h-4" />}>Sync Now</Button> : undefined} />
        ) : (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Material (item_cd)</TableHeaderCell><TableHeaderCell>Plant</TableHeaderCell><TableHeaderCell>CONF_MATERIAL (KMAT)</TableHeaderCell><TableHeaderCell>Synced At</TableHeaderCell></TableHeader>
              <TableBody>
                {paginated.map(m => (
                  <TableRow key={m.id}>
                    <TableCell><span className="font-mono font-medium text-slate-900">{m.material}</span></TableCell>
                    <TableCell><span className="text-xs font-mono text-slate-600">{m.plant}</span></TableCell>
                    <TableCell><Badge variant="blue">{m.confMaterial}</Badge></TableCell>
                    <TableCell><span className="text-xs text-slate-400">{formatDateTime(m.syncedAt)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={materials.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
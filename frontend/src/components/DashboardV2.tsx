'use client';

import { useEffect, useMemo, useState } from 'react';
import { Truck, CheckCircle2, MapPin, Timer, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import Pagination from '@/components/ui/Pagination';
import EmptyState from '@/components/ui/EmptyState';
import { SectionCard } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { ParkStatusBadge } from '@/components/ui/StatusBadge';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { formatDateTime, slotLabel } from '@/lib/format';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

type CardKey = 'inYard' | 'stage18Pending' | 'freeSpace';
type Period = 'all' | 'today' | '7d' | 'month' | 'fy' | 'custom';

interface MachineRow {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string;
  machineType: string | null;
  fertNo: string | null;
  fertDescription: string | null;
  assemblyStage: number;
  parkStatus: string;
  driverName: string | null;
  driverCode: string | null;
  eventAt: string | null;
  ageDays: number | null;
  yardName?: string | null;
  slotRow?: number | null;
  slotCol?: number | null;
  hasBarcode?: boolean;
}

interface SlotRow { id: string; yardName: string; row: number; col: number; zone: string | null; }
interface ModelCount { modelType: string; count: number; }

interface DashboardData {
  generatedAt: string;
  cards: {
    inYard: { count: number; byModelType: ModelCount[] };
    stage18Pending: { count: number; byModelType: ModelCount[] };
    freeSpace: { count: number; total: number; byYard: { yardId: string; yardName: string; free: number; total: number }[] };
  };
  rows: { inYard: MachineRow[]; stage18Pending: MachineRow[]; freeSpace: SlotRow[] };
}

interface FilterOptions {
  machineTypes: string[];
  fertNos: { code: string; description: string | null }[];
  drivers: { id: string; name: string; employeeCode: string | null }[];
}

const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'fy', label: 'This financial year' },
  { value: 'custom', label: 'Custom range' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Local-calendar range for a preset. The financial year runs April to March. */
function periodRange(period: Period, from: string, to: string): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case 'today': return { from: ymd(now), to: ymd(now) };
    case '7d': return { from: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to: ymd(now) };
    case 'month': return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
    case 'fy': {
      const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return { from: `${startYear}-04-01`, to: ymd(now) };
    }
    case 'custom': return { from: from || undefined, to: to || undefined };
    default: return {};
  }
}

const CARD_TITLES: Record<CardKey, string> = {
  inYard: 'Machines in yard',
  stage18Pending: '18th cleared - not inwarded',
  freeSpace: 'Free yard space',
};

function KpiCard({
  label, value, hint, icon, color, active, onClick, children, disabled,
}: {
  label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; color: string;
  active?: boolean; onClick?: () => void; children?: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left bg-white rounded-lg border p-3.5 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] transition-all
        ${active ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'}
        ${disabled ? 'opacity-60 cursor-not-allowed hover:shadow-none hover:border-slate-200' : 'cursor-pointer'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight mt-0.5">{value}</p>
          {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
        <div className={`p-2 rounded-md text-white shrink-0 ${color}`}>{icon}</div>
      </div>
      {children && <div className="mt-2.5 pt-2.5 border-t border-slate-100">{children}</div>}
    </button>
  );
}

function Breakdown({ items, selected, onSelect }: { items: { key: string; label: string; value: string }[]; selected?: string; onSelect?: (key: string) => void }) {
  if (items.length === 0) return <p className="text-[11px] text-slate-400">No machines</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(i => (
        <span
          key={i.key}
          role={onSelect ? 'button' : undefined}
          onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(i.key); } : undefined}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium
            ${selected === i.key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700'}
            ${onSelect ? 'hover:border-blue-400' : ''}`}
        >
          {i.label}<span className="tabular-nums font-semibold">{i.value}</span>
        </span>
      ))}
    </div>
  );
}

export default function DashboardV2() {
  const { token } = useAuth();

  const [options, setOptions] = useState<FilterOptions>({ machineTypes: [], fertNos: [], drivers: [] });
  const [machineType, setMachineType] = useState('');
  const [fertNo, setFertNo] = useState('');
  const [driverId, setDriverId] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  // Keyed by the query that produced it, so "loading" is derived instead of set in the effect.
  const [result, setResult] = useState<{ key: string; data: DashboardData | null; error?: string } | null>(null);

  const [activeCard, setActiveCard] = useState<CardKey>('inYard');
  const [modelFilter, setModelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const range = periodRange(period, customFrom, customTo);
  const query = new URLSearchParams(Object.entries({ machineType, fertNo, driverId, from: range.from ?? '', to: range.to ?? '' }).filter(([, v]) => v)).toString();
  const requestKey = `${query}#${reloadTick}`;

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/dashboard-v2/filters`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: FilterOptions | null) => { if (d) setOptions(d); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`${API_URL}/api/dashboard-v2${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async r => {
        const body = await r.json().catch(() => null);
        setResult(r.ok ? { key: requestKey, data: body } : { key: requestKey, data: null, error: body?.error || 'Failed to load dashboard' });
      })
      .catch(err => { if (err?.name !== 'AbortError') setResult({ key: requestKey, data: null, error: 'Could not reach the server' }); });
    return () => controller.abort();
  }, [token, query, requestKey]);

  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;

  const resetFilters = () => {
    setMachineType(''); setFertNo(''); setDriverId(''); setPeriod('all'); setCustomFrom(''); setCustomTo('');
    setModelFilter(''); setSearch(''); setPage(1);
  };

  const selectCard = (card: CardKey) => {
    setActiveCard(card); setModelFilter(''); setSearch(''); setPage(1);
  };

  const selectModel = (card: CardKey, modelType: string) => {
    setActiveCard(card);
    setModelFilter(prev => (activeCard === card && prev === modelType ? '' : modelType));
    setPage(1);
  };

  const machineRows = useMemo(() => {
    if (!data || activeCard === 'freeSpace') return [];
    const q = search.trim().toLowerCase();
    return data.rows[activeCard].filter(r =>
      (!modelFilter || r.modelType === modelFilter) &&
      (!q || [r.serialNumber, r.model, r.modelType, r.fertNo, r.fertDescription, r.yardName, r.driverName]
        .some(v => v && v.toLowerCase().includes(q))));
  }, [data, activeCard, modelFilter, search]);

  const slotRows = useMemo(() => {
    if (!data || activeCard !== 'freeSpace') return [];
    const q = search.trim().toLowerCase();
    return data.rows.freeSpace.filter(s => !q || [s.yardName, slotLabel(s.row, s.col), s.zone].some(v => v && v.toLowerCase().includes(q)));
  }, [data, activeCard, search]);

  const total = activeCard === 'freeSpace' ? slotRows.length : machineRows.length;
  const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const pageStart = (safePage - 1) * pageSize;

  if (!result && loading) return <PageSpinner />;

  const fertLabel = (code: string | null, desc: string | null) => (code ? `${code}${desc ? ` · ${desc}` : ''}` : '—');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard (New)"
        description={<>Under development - the current Dashboard stays live until this one replaces it.{data && <> · Updated {formatDateTime(data.generatedAt)}</>}</>}
        actions={<Button variant="ghost" icon={<RefreshCw className="w-4 h-4" />} loading={loading} onClick={() => setReloadTick(t => t + 1)}>Refresh</Button>}
      />

      {/* Common filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Select label="Machine type" value={machineType} onChange={e => { setMachineType(e.target.value); setPage(1); }} placeholder="All machine types" options={options.machineTypes.map(t => ({ value: t, label: t }))} />
          <Select label="FERT no" value={fertNo} onChange={e => { setFertNo(e.target.value); setPage(1); }} placeholder="All FERT numbers" options={options.fertNos.map(f => ({ value: f.code, label: fertLabel(f.code, f.description) }))} />
          <Select label="Period" value={period} onChange={e => { setPeriod(e.target.value as Period); setPage(1); }} options={PERIOD_OPTIONS} />
          <Select label="Operator (driver)" value={driverId} onChange={e => { setDriverId(e.target.value); setPage(1); }} placeholder="All drivers" options={options.drivers.map(d => ({ value: d.id, label: `${d.name}${d.employeeCode ? ` (${d.employeeCode})` : ''}` }))} />
          <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={resetFilters}>Reset filters</Button>
        </div>
        {period === 'custom' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mt-3">
            <Input label="From" type="date" value={customFrom} max={customTo || undefined} onChange={e => { setCustomFrom(e.target.value); setPage(1); }} />
            <Input label="To" type="date" value={customTo} min={customFrom || undefined} onChange={e => { setCustomTo(e.target.value); setPage(1); }} />
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Period applies to the gate inward date (machines in yard) and the stage 18 completion date (18th cleared). Free yard space is always the live position.
          {range.from && <> · {range.from} to {range.to ?? 'today'}</>}
        </p>
      </div>

      {result?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{result.error}</div>
      )}

      {/* Cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard
            label="Machines in yard"
            value={data.cards.inYard.count}
            hint="Active by model-type"
            icon={<Truck className="w-4 h-4" />}
            color="bg-blue-600"
            active={activeCard === 'inYard'}
            onClick={() => selectCard('inYard')}
          >
            <Breakdown
              items={data.cards.inYard.byModelType.map(m => ({ key: m.modelType, label: m.modelType, value: String(m.count) }))}
              selected={activeCard === 'inYard' ? modelFilter : undefined}
              onSelect={k => selectModel('inYard', k)}
            />
          </KpiCard>

          <KpiCard
            label="18th cleared - not inwarded"
            value={data.cards.stage18Pending.count}
            hint="SAP count vs our count: coming soon"
            icon={<CheckCircle2 className="w-4 h-4" />}
            color="bg-amber-600"
            active={activeCard === 'stage18Pending'}
            onClick={() => selectCard('stage18Pending')}
          >
            <Breakdown
              items={data.cards.stage18Pending.byModelType.map(m => ({ key: m.modelType, label: m.modelType, value: String(m.count) }))}
              selected={activeCard === 'stage18Pending' ? modelFilter : undefined}
              onSelect={k => selectModel('stage18Pending', k)}
            />
          </KpiCard>

          <KpiCard
            label="Free yard space"
            value={<>{data.cards.freeSpace.count}<span className="text-sm font-medium text-slate-400"> / {data.cards.freeSpace.total} slots</span></>}
            hint="Live - filters not applied"
            icon={<MapPin className="w-4 h-4" />}
            color="bg-emerald-600"
            active={activeCard === 'freeSpace'}
            onClick={() => selectCard('freeSpace')}
          >
            <Breakdown items={data.cards.freeSpace.byYard.map(y => ({ key: y.yardId, label: y.yardName, value: `${y.free}/${y.total}` }))} />
          </KpiCard>

          <KpiCard label="TAT" value="—" hint="Definition to be confirmed" icon={<Timer className="w-4 h-4" />} color="bg-slate-500" disabled>
            <p className="text-[11px] text-slate-400">Coming soon</p>
          </KpiCard>
        </div>
      )}

      {/* Details listing for the selected card */}
      {data && (
        <SectionCard
          title={`${CARD_TITLES[activeCard]} - details`}
          description={modelFilter ? `Model-type: ${modelFilter}` : undefined}
          noPadding
          action={
            <div className="flex items-center gap-2">
              {modelFilter && <Badge variant="blue">{modelFilter}</Badge>}
              <div className="w-56">
                <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search serial, FERT, yard..." icon={<Search className="w-4 h-4" />} />
              </div>
            </div>
          }
        >
          {total === 0 ? (
            <div className="p-4"><EmptyState title="Nothing to show" description="No records match the selected filters." /></div>
          ) : activeCard === 'freeSpace' ? (
            <Table>
              <TableHeader>
                <TableHeaderCell>Yard</TableHeaderCell>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Zone</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {slotRows.slice(pageStart, pageStart + pageSize).map(s => (
                  <TableRow key={s.id}>
                    <TableCell>{s.yardName}</TableCell>
                    <TableCell className="font-medium">{slotLabel(s.row, s.col)}</TableCell>
                    <TableCell>{s.zone || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableHeaderCell>Serial No</TableHeaderCell>
                <TableHeaderCell>Model-type</TableHeaderCell>
                <TableHeaderCell>Machine type</TableHeaderCell>
                <TableHeaderCell>FERT no</TableHeaderCell>
                {activeCard === 'inYard' ? (
                  <>
                    <TableHeaderCell>Yard / Slot</TableHeaderCell>
                    <TableHeaderCell>Inward on</TableHeaderCell>
                    <TableHeaderCell align="right">Days in yard</TableHeaderCell>
                  </>
                ) : (
                  <>
                    <TableHeaderCell>Barcode</TableHeaderCell>
                    <TableHeaderCell>18th cleared on</TableHeaderCell>
                    <TableHeaderCell align="right">Days pending</TableHeaderCell>
                  </>
                )}
                <TableHeaderCell>Park status</TableHeaderCell>
                <TableHeaderCell>Driver</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {machineRows.slice(pageStart, pageStart + pageSize).map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-900">{r.serialNumber}</TableCell>
                    <TableCell>{r.modelType}</TableCell>
                    <TableCell>{r.machineType || '—'}</TableCell>
                    <TableCell>
                      <span className="block text-[13px]">{r.fertNo || '—'}</span>
                      {r.fertDescription && <span className="block text-[11px] text-slate-400 max-w-[260px] truncate" title={r.fertDescription}>{r.fertDescription}</span>}
                    </TableCell>
                    {activeCard === 'inYard' ? (
                      <>
                        <TableCell>{r.yardName ? `${r.yardName} · ${r.slotRow != null && r.slotCol != null ? slotLabel(r.slotRow, r.slotCol) : ''}` : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(r.eventAt)}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{r.hasBarcode ? <Badge variant="green">Yes</Badge> : <Badge variant="red">Missing</Badge>}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateTime(r.eventAt)}</TableCell>
                      </>
                    )}
                    <TableCell align="right" className="tabular-nums">{r.ageDays ?? '—'}</TableCell>
                    <TableCell><ParkStatusBadge status={r.parkStatus} /></TableCell>
                    <TableCell>{r.driverName ? `${r.driverName}${r.driverCode ? ` (${r.driverCode})` : ''}` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {total > 0 && (
            <Pagination total={total} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1); }} />
          )}
        </SectionCard>
      )}
    </div>
  );
}

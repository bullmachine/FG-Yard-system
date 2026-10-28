'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { SectionCard } from '@/components/ui/Card';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { ModelStatusBadge } from '@/components/ui/StatusBadge';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface VehicleModelMaster { id: string; kmat: string; model: string; type: string; modelType: string; status: string; preferredYardId?: string; preferredYard?: { id: string; name: string }; _count?: { machines: number }; }
interface Yard { id: string; name: string; }

// Mirrors UNCLASSIFIED_KMAT_TYPE in backend/src/services/materialMasterService.ts,
// which the material sync assigns to rows it has to invent. Kept as a literal because
// the frontend cannot import backend code.
const UNCLASSIFIED_TYPE = 'UNCLASSIFIED';

// Mirrors MODEL_MASTER_STATUSES in the same file. The column default is PENDING, so a
// row the sync invented always lands here until somebody reviews it.
const STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE'] as const;
type ModelStatus = (typeof STATUSES)[number];
type StatusFilter = 'ALL' | ModelStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' }
];

export default function VehicleModelMasters() {
  const [masters, setMasters] = useState<VehicleModelMaster[]>([]);
  const [yards, setYards] = useState<Yard[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VehicleModelMaster | null>(null);
  const [form, setForm] = useState({ kmat: '', model: '', type: '', modelType: '', status: 'PENDING' as ModelStatus, preferredYardId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchData = async () => {
    try { const [m, y] = await Promise.all([fetch(`${API_URL}/api/vehicle-model-masters`, { headers: headers() }), fetch(`${API_URL}/api/yards`, { headers: headers() })]); setMasters(await m.json()); setYards(await y.json()); } catch { } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const derived = [form.model, form.type].filter(Boolean).join('-');
      const typedCustom = form.modelType.trim() !== '';
      // Keep modelType in sync with the model/type fields unless the user typed a
      // custom value: the backend short-circuits on any non-empty modelType, so
      // sending the stale value on every edit used to freeze it at its old text.
      let modelType: string;
      if (!editing) {
        modelType = typedCustom ? form.modelType.trim() : derived;
      } else if (form.modelType !== editing.modelType) {
        modelType = typedCustom ? form.modelType.trim() : derived;
      } else if (form.model !== editing.model || form.type !== editing.type) {
        modelType = derived;
      } else {
        modelType = editing.modelType;
      }
      // "" means "no preferred yard"; send null so the FK is cleared instead of failing.
      const payload = { ...form, modelType, preferredYardId: form.preferredYardId || null };
      const res = await fetch(`${editing ? `${API_URL}/api/vehicle-model-masters/${editing.id}` : `${API_URL}/api/vehicle-model-masters`}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(payload) });

      // The response used to be discarded, so a 400 "KMAT already exists" silently
      // closed the modal and looked like a success. Surface the server's message.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || `Request failed (${res.status})`);
        return;
      }

      setShowModal(false); setEditing(null); setForm({ kmat: '', model: '', type: '', modelType: '', status: 'PENDING', preferredYardId: '' }); fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this model master?')) return;
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/vehicle-model-masters/${id}`, { method: 'DELETE', headers: headers() });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || `Delete failed (${res.status})`);
        return;
      }
      fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const openEdit = (m: VehicleModelMaster) => { setEditing(m); setForm({ kmat: m.kmat, model: m.model, type: m.type, modelType: m.modelType, status: (m.status as ModelStatus) || 'PENDING', preferredYardId: m.preferredYardId || '' }); setShowModal(true); };
  const openCreate = () => { setEditing(null); setForm({ kmat: '', model: '', type: '', modelType: '', status: 'PENDING', preferredYardId: '' }); setShowModal(true); };

  const previewModelType = form.modelType || [form.model, form.type].filter(Boolean).join('-');

  if (loading) return <PageSpinner />;

  // Counts always come from the unfiltered list, so the tab numbers describe the whole
  // table rather than shrinking to whatever is currently selected.
  const statusCounts = STATUS_FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f.value] = f.value === 'ALL' ? masters.length : masters.filter((m) => (m.status || 'PENDING') === f.value).length;
    return acc;
  }, {});

  const filtered = statusFilter === 'ALL' ? masters : masters.filter((m) => (m.status || 'PENDING') === statusFilter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Two independent gaps, deliberately reported separately. A PENDING row is one the
  // material sync invented and nobody has checked; a missing preferred yard is what
  // actually sends its machines to an arbitrary yard, and that stays true even after
  // the row is marked ACTIVE.
  const pendingCount = masters.filter((m) => (m.status || 'PENDING') === 'PENDING').length;
  const noYardCount = masters.filter((m) => !m.preferredYardId).length;
  const noYardPending = masters.filter((m) => !m.preferredYardId && (m.status || 'PENDING') === 'PENDING').length;

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}

      <PageHeader
        title="Vehicle Model Master"
        description={`Model-wise yard allocation masters (${masters.length})`}
        actions={isAdmin ? <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>Add Model</Button> : undefined}
      />

      {pendingCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          <span className="font-semibold">{pendingCount} of {masters.length} are Pending.</span>{' '}
          The Material Master sync added these KMATs on its own, and it can only copy the KMAT into{' '}
          <span className="font-medium">model</span> - SAP sends no model or type. A sync never edits an
          existing row, so nothing here changes on its own. Check each one, set a real{' '}
          <span className="font-medium">type</span> and <span className="font-medium">preferred yard</span>,
          then move its status to Active.
        </div>
      )}

      {noYardCount > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800">
          <span className="font-semibold">{noYardCount} of {masters.length} have no preferred yard</span>
          {noYardPending > 0 && <> ({noYardPending} of them still Pending)</>}. Until a yard is set, machines
          on those models are placed in an arbitrary yard rather than their model&apos;s home yard. Marking a
          row Active does not change this - the yard is what routes.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => {
          const selected = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => { setStatusFilter(f.value); setPage(1); }}
              aria-pressed={selected}
              className={`rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500 ${
                selected ? 'bg-blue-700 text-white' : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 tabular-nums ${selected ? 'text-blue-100' : 'text-slate-400'}`}>{statusCounts[f.value]}</span>
            </button>
          );
        })}
      </div>

      <SectionCard title="Vehicle Models" description="KMAT matches CONF_MATERIAL from the Material Master" bodyClassName={paginated.length === 0 ? '' : 'p-0'}>
        {masters.length === 0 ? (
          <EmptyState title="No model masters" description="Add your first KMAT / model / type mapping" action={isAdmin ? <Button size="sm" onClick={openCreate}>Add Model</Button> : undefined} />
        ) : paginated.length === 0 ? (
          <EmptyState title={`No ${statusFilter.toLowerCase()} models`} description={`${statusCounts[statusFilter]} of ${masters.length} models match this filter.`} action={<Button size="sm" variant="secondary" onClick={() => { setStatusFilter('ALL'); setPage(1); }}>Show all</Button>} />
        ) : (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>KMAT</TableHeaderCell><TableHeaderCell>Model</TableHeaderCell><TableHeaderCell>Type</TableHeaderCell><TableHeaderCell>Model-Type</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Preferred Yard</TableHeaderCell><TableHeaderCell>Machines</TableHeaderCell>{isAdmin && <TableHeaderCell align="right">Actions</TableHeaderCell>}</TableHeader>
              <TableBody>
                {paginated.map(m => {
                  const status = m.status || 'PENDING';
                  const placeholder = m.type === UNCLASSIFIED_TYPE;
                  // Tint while the row is unreviewed OR unrouted; either one is worth seeing.
                  const flagged = status === 'PENDING' || !m.preferredYardId;
                  return (
                  <TableRow key={m.id} className={flagged ? 'bg-amber-50/40' : undefined}>
                    <TableCell><span className="font-mono font-medium text-slate-900">{m.kmat}</span></TableCell>
                    <TableCell>{m.model}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium uppercase ${placeholder ? 'text-amber-700' : 'text-slate-600'}`}>{m.type}</span>
                    </TableCell>
                    <TableCell><Badge>{m.modelType}</Badge></TableCell>
                    <TableCell><ModelStatusBadge status={status} /></TableCell>
                    <TableCell>
                      {m.preferredYard?.name
                        ? <span>{m.preferredYard.name}</span>
                        : <span className="text-xs font-medium text-amber-700">Not set</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{m._count?.machines || 0}</TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(m)} aria-label="Edit model master"><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(m.id)} aria-label="Delete model master"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
      </SectionCard>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Vehicle Model' : 'Add Vehicle Model'} footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit} loading={submitting}>{editing ? 'Update' : 'Create'}</Button></>}>
        <div className="space-y-3.5">
          <Input label="KMAT (from Material Master)" value={form.kmat} onChange={e => setForm({ ...form, kmat: e.target.value })} placeholder="e.g. BSBHLSKID" disabled={!!editing} />
          <Input label="Model" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="e.g. SKID 490" />
          <Input label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="e.g. SKID" />
          <Input label="Model-Type (auto-filled)" value={form.modelType} onChange={e => setForm({ ...form, modelType: e.target.value })} placeholder={previewModelType} />
          <p className="text-xs text-slate-500">Preview: <span className="font-semibold text-blue-700">{previewModelType}</span></p>
          <Select label="Preferred Yard" value={form.preferredYardId} onChange={e => setForm({ ...form, preferredYardId: e.target.value })} options={[{ value: '', label: 'None' }, ...yards.map(y => ({ value: y.id, label: y.name }))]} />
          <Select
            label="Status"
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value as ModelStatus })}
            options={[
              { value: 'PENDING', label: 'Pending - added by sync, not yet reviewed' },
              { value: 'ACTIVE', label: 'Active - checked and in use' },
              { value: 'INACTIVE', label: 'Inactive - retired, kept for history' }
            ]}
          />
          <p className="text-xs text-slate-500">
            Status is a review label only - no routing or assignment decision reads it, so setting it
            cannot move a machine. The Material Master sync never edits an existing row; it only adds new
            ones as <span className="font-semibold">Pending</span>.
          </p>
        </div>
      </Modal>
    </div>
  );
}
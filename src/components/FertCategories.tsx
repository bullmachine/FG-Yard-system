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
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface FertCategory { id: string; code: string; name: string; priority: number; preferredYardId?: string; preferredYard?: { id: string; name: string }; _count?: { machines: number }; }
interface Yard { id: string; name: string; }

export default function FertCategories() {
  const [categories, setCategories] = useState<FertCategory[]>([]);
  const [yards, setYards] = useState<Yard[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<FertCategory | null>(null);
  const [form, setForm] = useState({ code: '', name: '', priority: 0, preferredYardId: '' });
  const [submitting, setSubmitting] = useState(false);
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchData = async () => {
    try { const [c, y] = await Promise.all([fetch(`${API_URL}/api/fert-categories`, { headers: headers() }), fetch(`${API_URL}/api/yards`, { headers: headers() })]); setCategories(await c.json()); setYards(await y.json()); } catch { } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    try { await fetch(`${editing ? `${API_URL}/api/fert-categories/${editing.id}` : `${API_URL}/api/fert-categories`}`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(form) }); setShowModal(false); setEditing(null); setForm({ code: '', name: '', priority: 0, preferredYardId: '' }); fetchData(); } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await fetch(`${API_URL}/api/fert-categories/${id}`, { method: 'DELETE', headers: headers() }); fetchData();
  };

  const openEdit = (cat: FertCategory) => { setEditing(cat); setForm({ code: cat.code, name: cat.name, priority: cat.priority, preferredYardId: cat.preferredYardId || '' }); setShowModal(true); };
  const openCreate = () => { setEditing(null); setForm({ code: '', name: '', priority: 0, preferredYardId: '' }); setShowModal(true); };

  if (loading) return <PageSpinner />;

  const totalPages = Math.max(1, Math.ceil(categories.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = categories.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-4">
      <PageHeader
        title="FERT Categories"
        description={`${categories.length} categories`}
        actions={isAdmin ? <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>Add Category</Button> : undefined}
      />

      <SectionCard title="Categories" bodyClassName={paginated.length === 0 ? '' : 'p-0'}>
        {categories.length === 0 ? (
          <EmptyState title="No categories" description="Add your first FERT category" action={isAdmin ? <Button size="sm" onClick={openCreate}>Add Category</Button> : undefined} />
        ) : (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Code</TableHeaderCell><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Priority</TableHeaderCell><TableHeaderCell>Preferred Yard</TableHeaderCell><TableHeaderCell>Machines</TableHeaderCell>{isAdmin && <TableHeaderCell align="right">Actions</TableHeaderCell>}</TableHeader>
              <TableBody>
                {paginated.map(cat => (
                  <TableRow key={cat.id}>
                    <TableCell><span className="font-medium text-slate-900">{cat.code}</span></TableCell>
                    <TableCell>{cat.name}</TableCell>
                    <TableCell className="tabular-nums">{cat.priority}</TableCell>
                    <TableCell>{cat.preferredYard?.name || '—'}</TableCell>
                    <TableCell className="tabular-nums">{cat._count?.machines || 0}</TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(cat)} aria-label="Edit category"><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(cat.id)} aria-label="Delete category"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={categories.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
      </SectionCard>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Category' : 'Add Category'} footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit} loading={submitting}>{editing ? 'Update' : 'Create'}</Button></>}>
        <div className="space-y-3.5">
          <Input label="Code" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. SKID" />
          <Input label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. SKID Type" />
          <Input label="Priority" type="number" value={form.priority} onChange={e => setForm({ ...form, priority: Number(e.target.value) })} />
          <Select label="Preferred Yard" value={form.preferredYardId} onChange={e => setForm({ ...form, preferredYardId: e.target.value })} options={[{ value: '', label: 'None' }, ...yards.map(y => ({ value: y.id, label: y.name }))]} />
        </div>
      </Modal>
    </div>
  );
}
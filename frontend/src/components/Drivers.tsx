'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Pagination from '@/components/ui/Pagination';
import { SectionCard } from '@/components/ui/Card';
import { Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Plus, Pencil, Trash2, Barcode, KeyRound, Camera, UserRound, X, Printer } from 'lucide-react';
import { downscaleToJpeg } from '@/lib/image';
import { formatDateTime } from '@/lib/format';
import { Barcode as BarcodeSvg, canEncodeCode128 } from '@/lib/barcode';

// Browser-only gate for the portaled helper: getServerSnapshot keeps SSR and
// hydration markup identical (no print sheet), the client snapshot flips it on
// right after hydration - without a setState inside an effect, which the lint
// rejects.
const subscribeEmpty = () => () => {};

interface DriverUser { id: string; name: string; email: string; isActive: boolean; }
interface Driver { id: string; name: string; phone?: string | null; licenseNo?: string | null; employeeCode?: string | null; photoUrl?: string | null; status: string; user?: DriverUser | null; _count?: { machines: number }; }

interface DriverForm { name: string; phone: string; licenseNo: string; employeeCode: string; }
const EMPTY_FORM: DriverForm = { name: '', phone: '', licenseNo: '', employeeCode: '' };

export default function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [form, setForm] = useState<DriverForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [accountFor, setAccountFor] = useState<Driver | null>(null);
  const [accountForm, setAccountForm] = useState({ email: '', password: '' });
  const [accountError, setAccountError] = useState<string | null>(null);
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'YARD_MANAGER');
  const isSysAdmin = user?.role === 'ADMIN';
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  // The printable badge sheet is portaled to document.body, which only exists on the client.
  const mounted = useSyncExternalStore(subscribeEmpty, () => true, () => false);

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  const fetchDrivers = async () => {
    try { const r = await fetch(`${API_URL}/api/drivers`, { headers: headers() }); setDrivers(await r.json()); } catch { } finally { setLoading(false); }
  };
  useEffect(() => { fetchDrivers(); }, []);

  const closeModal = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const openCreate = () => {
    closeModal();
    setShowModal(true);
  };

  const openEdit = (d: Driver) => {
    closeModal();
    setEditing(d);
    setForm({ name: d.name, phone: d.phone || '', licenseNo: d.licenseNo || '', employeeCode: d.employeeCode || '' });
    setShowModal(true);
  };

  const pickPhoto = (file: File) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const discardPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      if (!form.name.trim()) { setFormError('Driver name is required'); return; }

      const [method, url] = editing
        ? ['PUT', `${API_URL}/api/drivers/${editing.id}`] as const
        : ['POST', `${API_URL}/api/drivers`] as const;
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify(form) });
      const body = (await r.json().catch(() => ({}))) as Partial<Driver> & { error?: string };
      if (!r.ok) { setFormError(body.error || 'Failed to save driver'); return; }
      const saved = body as Driver;

      if (photoFile) {
        const blob = await downscaleToJpeg(photoFile).catch((err: unknown) => {
          setFormError((err as Error).message || 'The photo could not be processed');
          return null;
        });
        if (!blob) return;

        const fd = new FormData();
        fd.append('photo', blob, 'photo.jpg');
        const pr = await fetch(`${API_URL}/api/drivers/${saved.id}/photo`, { method: 'POST', headers: headers(), body: fd });
        const pbody = (await pr.json().catch(() => ({}))) as { error?: string };
        if (!pr.ok) { setFormError(pbody.error || 'Driver saved, but the photo could not be uploaded'); return; }
      }

      closeModal();
      fetchDrivers();
    } catch {
      setFormError('Could not reach the server');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this driver? This also removes their photo and cannot be undone.')) return;
    const r = await fetch(`${API_URL}/api/drivers/${id}`, { method: 'DELETE', headers: headers() });
    if (!r.ok) { const body = await r.json().catch(() => ({})); alert((body as { error?: string }).error || 'Could not delete the driver'); return; }
    fetchDrivers();
  };

  const handleRemovePhoto = async (d: Driver) => {
    if (!confirm(`Remove the photo for ${d.name}?`)) return;
    const r = await fetch(`${API_URL}/api/drivers/${d.id}/photo`, { method: 'DELETE', headers: headers() });
    if (!r.ok) { const body = await r.json().catch(() => ({})); setFormError((body as { error?: string }).error || 'Could not remove the photo'); return; }
    setEditing(e => (e ? { ...e, photoUrl: null } : e));
    fetchDrivers();
  };

  const openAccount = (d: Driver) => { setAccountFor(d); setAccountForm({ email: '', password: '' }); setAccountError(null); };

  const handleCreateAccount = async () => {
    if (!accountFor) return;
    setSubmitting(true);
    setAccountError(null);
    try {
      const r = await fetch(`${API_URL}/api/drivers/${accountFor.id}/account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(accountForm)
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setAccountError(body.error || 'Could not create the login'); return; }
      setAccountFor(null);
      fetchDrivers();
    } catch { setAccountError('Could not reach the server'); }
    finally { setSubmitting(false); }
  };

  const handleRemoveAccount = async (d: Driver) => {
    if (!confirm(`Remove the login for ${d.name}? The account is deactivated but their past records are kept.`)) return;
    const r = await fetch(`${API_URL}/api/drivers/${d.id}/account`, { method: 'DELETE', headers: headers() });
    if (!r.ok) { const body = await r.json().catch(() => ({})); alert(body.error || 'Could not remove the login'); return; }
    fetchDrivers();
  };

  if (loading) return <PageSpinner />;

  const totalPages = Math.max(1, Math.ceil(drivers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = drivers.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Drivers that have a badge to print: an employee code that Code 128 can encode.
  const badgedDrivers = drivers.filter(d => d.employeeCode && canEncodeCode128(d.employeeCode));
  const previewUrl = photoPreview ?? (editing?.photoUrl ? `${API_URL}${editing.photoUrl}` : null);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Drivers"
        description={`${drivers.length} drivers`}
        actions={isAdmin ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" icon={<Printer className="w-4 h-4" />} onClick={() => window.print()} disabled={!badgedDrivers.length}>Print Badges</Button>
            <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>Add Driver</Button>
          </div>
        ) : undefined}
      />

      <SectionCard title="Driver Roster" bodyClassName={paginated.length === 0 ? '' : 'p-0'}>
        {drivers.length === 0 ? (
          <EmptyState title="No drivers" description="Add your first driver" action={isAdmin ? <Button size="sm" onClick={openCreate}>Add Driver</Button> : undefined} />
        ) : (
          <div>
            <Table>
              <TableHeader><TableHeaderCell>Photo</TableHeaderCell><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Phone</TableHeaderCell><TableHeaderCell>License</TableHeaderCell><TableHeaderCell>Employee Code</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Login</TableHeaderCell><TableHeaderCell>Assigned</TableHeaderCell>{isAdmin && <TableHeaderCell align="right">Actions</TableHeaderCell>}</TableHeader>
              <TableBody>
                {paginated.map(d => (
                  <TableRow key={d.id}>
                    <TableCell>
                      {d.photoUrl
                        ? <img src={`${API_URL}${d.photoUrl}`} alt={d.name} className="w-7 h-7 rounded-full object-cover" />
                        : <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-400"><UserRound className="w-3.5 h-3.5" /></div>}
                    </TableCell>
                    <TableCell><span className="font-medium text-slate-900">{d.name}</span></TableCell>
                    <TableCell>{d.phone || '—'}</TableCell>
                    <TableCell>{d.licenseNo || '—'}</TableCell>
                    <TableCell>
                      {d.employeeCode ? <Badge variant="indigo" dot>{d.employeeCode}</Badge> : <span className="text-xs text-slate-400 italic">No badge</span>}
                    </TableCell>
                    <TableCell><Badge variant={d.status === 'AVAILABLE' ? 'green' : 'amber'} dot>{d.status}</Badge></TableCell>
                    <TableCell>
                      {d.user
                        ? <Badge variant={d.user.isActive ? 'indigo' : 'gray'} dot>{d.user.email}</Badge>
                        : <span className="text-xs text-slate-400 italic">No login</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{d._count?.machines || 0}</TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          {isSysAdmin && (
                            d.user
                              ? <Button variant="ghost" size="icon" onClick={() => handleRemoveAccount(d)} aria-label="Remove driver login"><KeyRound className="w-3.5 h-3.5" /></Button>
                              : <Button variant="ghost" size="icon" onClick={() => openAccount(d)} aria-label="Create driver login"><KeyRound className="w-3.5 h-3.5" /></Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => openEdit(d)} aria-label="Edit driver"><Pencil className="w-3.5 h-3.5" /></Button>
                          {/* Deleting a driver is ADMIN-only on the server. */}
                          {isSysAdmin && <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)} aria-label="Delete driver"><Trash2 className="w-3.5 h-3.5" /></Button>}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination total={drivers.length} page={safePage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} compact />
          </div>
        )}
      </SectionCard>

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit Driver' : 'Add Driver'} footer={<><Button variant="secondary" onClick={closeModal}>Cancel</Button><Button onClick={handleSubmit} loading={submitting}>{editing ? 'Update' : 'Create'}</Button></>}>
        <div className="space-y-3.5">
          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{formError}</div>
          )}
          <Input label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Driver name" />
          <Input label="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+966501234567" />
          <Input label="License No" value={form.licenseNo} onChange={e => setForm({ ...form, licenseNo: e.target.value })} placeholder="DL-001" />
          <Input
            label="Employee Code"
            value={form.employeeCode}
            onChange={e => setForm({ ...form, employeeCode: e.target.value })}
            placeholder="e.g. EMP-001 or the badge number"
            icon={<Barcode className="w-4 h-4" />}
            hint="This is what the gate guard scans from the driver's badge."
          />

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Photo</label>
            <div className="flex items-center gap-3">
              {previewUrl
                ? <img src={previewUrl} alt={editing?.name ?? 'Photo preview'} className="w-14 h-14 rounded-lg object-cover" />
                : <div className="w-14 h-14 rounded-lg bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-slate-400"><UserRound className="w-5 h-5" /></div>}
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} icon={<Camera className="w-3.5 h-3.5" />}>
                    {previewUrl ? 'Replace photo' : 'Upload photo'}
                  </Button>
                  {photoFile && (
                    <Button variant="ghost" size="sm" onClick={discardPhoto} icon={<X className="w-3.5 h-3.5" />}>Discard</Button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">JPEG, PNG or WebP · resized to 400×400</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickPhoto(f); e.target.value = ''; }}
              />
            </div>
            {editing && editing.photoUrl && !photoFile && (
              <Button variant="ghost" size="sm" className="mt-1.5 text-red-600 hover:text-red-700" onClick={() => handleRemovePhoto(editing)} icon={<Trash2 className="w-3.5 h-3.5" />}>
                Remove photo
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={accountFor !== null}
        onClose={() => setAccountFor(null)}
        title={accountFor ? `Create login for ${accountFor.name}` : ''}
        footer={<><Button variant="secondary" onClick={() => setAccountFor(null)}>Cancel</Button><Button onClick={handleCreateAccount} loading={submitting} disabled={!accountForm.email || !accountForm.password}>Create login</Button></>}
      >
        <div className="space-y-3.5">
          <p className="text-xs text-slate-500">
            A driver with a login can confirm parking on the yard device and will be notified when
            security approves or rejects it. The account is created with the Driver role only.
          </p>
          {accountError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{accountError}</div>
          )}
          <Input label="Email" type="email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} placeholder="driver@yard.local" />
          <Input label="Password" type="password" value={accountForm.password} onChange={e => setAccountForm({ ...accountForm, password: e.target.value })} placeholder="At least 6 characters" />
        </div>
      </Modal>

      {/* Printable driver badge sheet. Portaled into <body> so the @media print
          rule can collapse everything else and print a clean sheet. */}
      {mounted && badgedDrivers.length > 0 && createPortal(
        <div id="driver-barcodes" className="hidden print-area">
          <div className="px-6 py-4 border-b border-slate-300 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">FG Yard — Driver Badges</p>
              <p className="text-xs text-slate-500">{badgedDrivers.length} printed · {formatDateTime(new Date().toISOString())}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-6">
            {badgedDrivers.map(d => (
              <div key={d.id} className="border border-dashed border-slate-400 rounded-lg p-3 break-inside-avoid">
                <div className="flex items-center gap-3">
                  {d.photoUrl
                    ? <img src={`${API_URL}${d.photoUrl}`} alt={d.name} className="w-12 h-12 rounded-md object-cover" />
                    : <div className="w-12 h-12 rounded-md bg-slate-200 flex items-center justify-center text-slate-400"><UserRound className="w-5 h-5" /></div>}
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Yard Gate · Driver Badge</p>
                    <p className="text-sm font-bold text-slate-900 leading-tight">{d.name}</p>
                    <p className="text-xs text-slate-600">{d.employeeCode}</p>
                  </div>
                </div>
                {d.employeeCode && <BarcodeSvg code={d.employeeCode} height={40} className="mt-2.5" />}
              </div>
            ))}
          </div>
          <p className="px-6 pb-6 text-xs text-slate-500">The gate guard scans the barcode as the employee code for that driver.</p>
        </div>,
        document.body
      )}
    </div>
  );
}
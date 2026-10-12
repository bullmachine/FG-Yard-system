'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Pencil, Plus, Power, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import PageHeader from '@/components/ui/PageHeader';
import Select from '@/components/ui/Select';
import { SectionCard } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@/components/ui/Table';

type UserRole = 'ADMIN' | 'YARD_MANAGER' | 'OPERATOR' | 'SERVICE_TECHNICIAN' | 'SECURITY' | 'VIEW_ONLY';

interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive: boolean;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'YARD_MANAGER', label: 'Yard Manager' },
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'SERVICE_TECHNICIAN', label: 'Service Technician' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'VIEW_ONLY', label: 'View Only' },
];

const emptyForm: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'VIEW_ONLY',
  isActive: true,
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const roleLabel = (role: UserRole) => ROLE_OPTIONS.find((option) => option.value === role)?.label || role;

export default function UserManagement() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [error, setError] = useState('');

  const headers = () => {
    const requestHeaders: Record<string, string> = {};
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    return requestHeaders;
  };

  const fetchUsers = async () => {
    const response = await fetch(`${API_URL}/api/users`, { headers: headers() });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to fetch users');
    setUsers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    const controller = new AbortController();
    const requestHeaders: Record<string, string> = {};
    if (token) requestHeaders.Authorization = `Bearer ${token}`;

    fetch(`${API_URL}/api/users`, { headers: requestHeaders, signal: controller.signal })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok) {
          const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string' ? data.error : 'Failed to fetch users';
          throw new Error(message);
        }
        return data;
      })
      .then((data: unknown) => {
        setUsers(Array.isArray(data) ? data as User[] : []);
        setError('');
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to fetch users');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (selectedUser: User) => {
    setEditing(selectedUser);
    setForm({
      name: selectedUser.name,
      email: selectedUser.email,
      password: '',
      role: selectedUser.role,
      isActive: selectedUser.isActive,
    });
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
    setEditing(null);
    setError('');
  };

  const handleSubmit = async () => {
    const invalidPassword = form.password.length < 8 && (!editing || form.password.length > 0);
    if (!form.name.trim() || !form.email.trim() || invalidPassword) {
      setError('Complete all required fields; passwords must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/users${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          role: form.role,
          isActive: form.isActive,
          ...(editing && !form.password ? {} : { password: form.password }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save user');
      setShowModal(false);
      setEditing(null);
      setForm(emptyForm);
      fetchUsers().catch(() => setError('User saved, but the account list could not be refreshed'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (selectedUser: User) => {
    if (selectedUser.id === currentUser?.id) return;
    const nextStatus = !selectedUser.isActive;
    if (!confirm(`${nextStatus ? 'Activate' : 'Deactivate'} ${selectedUser.name}?`)) return;

    setActionId(selectedUser.id);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ isActive: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update user status');
      fetchUsers().catch(() => setError('Status updated, but the account list could not be refreshed'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update user status');
    } finally {
      setActionId(null);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="User Management"
        description="Manage accounts, roles, and access status"
        actions={<Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>Add User</Button>}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <SectionCard title="User Accounts" bodyClassName={users.length === 0 ? '' : 'p-0'}>
        {users.length === 0 ? (
          <EmptyState title="No users found" description="Create the first user account" action={<Button size="sm" onClick={openCreate}>Add User</Button>} />
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {users.map((managedUser) => (
                <TableRow key={managedUser.id}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{managedUser.name}</div>
                    <div className="text-xs text-slate-500">{managedUser.email}</div>
                  </TableCell>
                  <TableCell><Badge variant={managedUser.role === 'ADMIN' ? 'indigo' : 'blue'}>{roleLabel(managedUser.role)}</Badge></TableCell>
                  <TableCell><Badge variant={managedUser.isActive ? 'green' : 'red'} dot>{managedUser.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className="text-xs text-slate-500">{new Date(managedUser.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(managedUser)} aria-label={`Edit ${managedUser.name}`} title="Edit user">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggle(managedUser)}
                        disabled={managedUser.id === currentUser?.id || actionId === managedUser.id}
                        aria-label={`${managedUser.isActive ? 'Deactivate' : 'Activate'} ${managedUser.name}`}
                        title={managedUser.id === currentUser?.id ? 'You cannot deactivate your own account' : managedUser.isActive ? 'Deactivate user' : 'Activate user'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit User' : 'Add User'} subtitle={editing ? editing.email : 'Create an account with a controlled role'} footer={<><Button variant="secondary" onClick={closeModal}>Cancel</Button><Button onClick={handleSubmit} loading={submitting}>{editing ? 'Save Changes' : 'Create User'}</Button></>}>
        <div className="space-y-3.5">
          <Input label="Full Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="User name" required />
          <Input label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="user@company.com" required />
          <Select label="Role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })} options={ROLE_OPTIONS} disabled={editing?.id === currentUser?.id} />
          <Input label={editing ? 'New Password' : 'Password'} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editing ? 'Leave empty to keep current password' : 'At least 8 characters'} required={!editing} minLength={editing ? 0 : 8} />
          {editing && (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={form.isActive} disabled={editing.id === currentUser?.id} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              Account is active
              {editing.id === currentUser?.id && <span className="text-slate-400">You cannot deactivate your own account</span>}
            </label>
          )}
          <div className="flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{editing?.id === currentUser?.id ? 'You cannot change your own role.' : 'Role changes take effect on the user\'s next authenticated request.'}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

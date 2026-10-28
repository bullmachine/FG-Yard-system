'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, RotateCcw, Save } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Matrix {
  roles: string[];
  permissions: { key: string; group: string; label: string }[];
  allowed: Record<string, string[]>;
  defaults: Record<string, string[]>;
  locked: Record<string, string[]>;
  log: { id: string; role: string; permission: string; allowed: boolean; changedAt: string; changedBy: { name: string } }[];
}

const ROLE_LABELS: Record<string, string> = {
  YARD_MANAGER: 'Yard Manager',
  OPERATOR: 'Operator',
  SERVICE_TECHNICIAN: 'Service Tech',
  SECURITY: 'Security',
  VIEW_ONLY: 'View Only',
  DRIVER: 'Driver',
  PLANNER: 'Planner',
  PDI: 'PDI Team',
  MAIN_GATE: 'Main Gate',
};

const cellKey = (role: string, permission: string) => `${role}:${permission}`;

/**
 * Which role may open each page and do each action. Admin always has everything, and
 * User Management, Settings and Role Access stay Admin-only. The server enforces the
 * same matrix, so unticking a box also blocks the action, not only the menu.
 */
export default function RoleAccess() {
  const { user } = useAuth();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() =>
    fetch(`${API_URL}/api/role-access`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || `Load failed (${r.status})`);
        setMatrix(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false)), []);

  useEffect(() => { load(); }, [load]);

  const allowed = useMemo(() => new Set(matrix ? Object.entries(matrix.allowed).flatMap(([r, ks]) => ks.map((k) => cellKey(r, k))) : []), [matrix]);
  const defaults = useMemo(() => new Set(matrix ? Object.entries(matrix.defaults).flatMap(([r, ks]) => ks.map((k) => cellKey(r, k))) : []), [matrix]);
  const locked = useMemo(() => new Set(matrix ? Object.entries(matrix.locked).flatMap(([r, ks]) => ks.map((k) => cellKey(r, k))) : []), [matrix]);
  const groups = useMemo(() => {
    const m = new Map<string, Matrix['permissions']>();
    for (const p of matrix?.permissions ?? []) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [matrix]);

  if (user?.role !== 'ADMIN') {
    return <p className="text-sm text-slate-600">Only an Administrator can manage role access.</p>;
  }
  if (loading) return <PageSpinner />;

  const value = (role: string, key: string) => draft.get(cellKey(role, key)) ?? allowed.has(cellKey(role, key));
  const toggle = (role: string, key: string) => {
    const k = cellKey(role, key);
    setDraft((prev) => {
      const next = new Map(prev);
      const v = !(prev.get(k) ?? allowed.has(k));
      if (v === allowed.has(k)) next.delete(k); else next.set(k, v);
      return next;
    });
    setNotice(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes = [...draft.entries()].map(([k, allowedValue]) => {
        const [role, permission] = k.split(':');
        return { role, permission, allowed: allowedValue };
      });
      const r = await fetch(`${API_URL}/api/role-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ changes }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error || `Save failed (${r.status})`); return; }
      setMatrix(d.matrix);
      setDraft(new Map());
      setNotice(`${d.changed} change${d.changed === 1 ? '' : 's'} saved. Users see them the next time they open or refresh the app.`);
    } catch {
      setError('Connection error - try again');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Put every role back to the default access? Your changes on this page will be undone.')) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/role-access/reset`, { method: 'POST', headers: authHeaders() });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error || `Reset failed (${r.status})`); return; }
      setMatrix(d.matrix);
      setDraft(new Map());
      setNotice(d.changed ? `Back to default access (${d.changed} change${d.changed === 1 ? '' : 's'}).` : 'Already at the default access.');
    } catch {
      setError('Connection error - try again');
    } finally {
      setSaving(false);
    }
  };

  const permLabel = (key: string) => {
    const p = matrix?.permissions.find((x) => x.key === key);
    return p ? `${p.group} · ${p.label}` : key;
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Role Access"
        description="Which role may open each page and do each action. The server enforces it too."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset} disabled={saving} icon={<RotateCcw className="w-4 h-4" />}>Reset to Default</Button>
            {draft.size > 0 && <Button variant="secondary" onClick={() => setDraft(new Map())} disabled={saving}>Discard</Button>}
            <Button onClick={save} loading={saving} disabled={draft.size === 0} icon={<Save className="w-4 h-4" />}>
              Save{draft.size ? ` (${draft.size})` : ''}
            </Button>
          </div>
        }
      />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Administrator always has full access. User Management, Settings and Role Access stay Administrator-only.
        Help, Docs, SOP and Notifications are open to everyone. A driver can only be given Dashboard, Confirm Parking and Exit Requests.
        An action needs its page too: a role that cannot open a page cannot use its buttons.
      </p>

      {matrix && (
        <SectionCard title="Access matrix" description="Tick to allow. A dot marks a change from the default." noPadding>
          <div className="overflow-auto max-h-[70vh]">
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600">Page / action</th>
                  {matrix.roles.map((r) => (
                    <th key={r} className="border-b border-slate-200 px-2 py-2 text-center font-semibold text-slate-600 whitespace-nowrap">{ROLE_LABELS[r] ?? r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([group, perms]) => (
                  <Fragment key={group}>
                    <tr>
                      <td colSpan={matrix.roles.length + 1} className="sticky left-0 border-b border-slate-100 bg-white px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group}</td>
                    </tr>
                    {perms.map((p) => {
                      const isPage = p.key.startsWith('page.');
                      return (
                        <tr key={p.key} className="hover:bg-slate-50">
                          <td className={`sticky left-0 border-b border-slate-100 bg-white px-3 py-1.5 whitespace-nowrap ${isPage ? 'font-medium text-slate-900' : 'pl-6 text-slate-700'}`}>{p.label}</td>
                          {matrix.roles.map((r) => {
                            const k = cellKey(r, p.key);
                            if (locked.has(k)) {
                              return (
                                <td key={r} className="border-b border-slate-100 px-2 py-1.5 text-center" title="A driver cannot be given this">
                                  <Lock className="mx-auto h-3 w-3 text-slate-300" aria-label="Not available for this role" />
                                </td>
                              );
                            }
                            const v = value(r, p.key);
                            const changed = draft.has(k);
                            const differs = v !== defaults.has(k);
                            return (
                              <td key={r} className={`border-b border-slate-100 px-2 py-1.5 text-center ${changed ? 'bg-amber-50' : ''}`}>
                                <span className="relative inline-flex">
                                  <input
                                    type="checkbox"
                                    checked={v}
                                    onChange={() => toggle(r, p.key)}
                                    aria-label={`${ROLE_LABELS[r] ?? r}: ${p.group} - ${p.label}`}
                                    className="h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  {differs && <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-amber-500" title="Changed from the default" />}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {matrix && (
        <SectionCard title="Recent changes" description="Last 30 changes made on this page" noPadding>
          {matrix.log.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">No changes yet. Every role has the default access.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {matrix.log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 px-4 py-1.5 text-xs">
                  <span className={`font-semibold ${l.allowed ? 'text-emerald-700' : 'text-red-700'}`}>{l.allowed ? 'Allowed' : 'Removed'}</span>
                  <span className="text-slate-800">{ROLE_LABELS[l.role] ?? l.role} · {permLabel(l.permission)}</span>
                  <span className="text-slate-400">{l.changedBy.name}, {formatDateTime(l.changedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}

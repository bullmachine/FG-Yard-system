'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, PlugZap, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { PageSpinner } from '@/components/ui/Spinner';
import { API_URL, authHeaders } from '@/lib/api';

interface Settings {
  productionApiUrl: string;
  productionSyncDays: number;
  productionCron: string;
  productionTimeoutMs: number;
  materialApiUrl: string;
  materialUsername: string;
  materialPlant: string;
  materialSyncDays: number;
  materialCron: string;
  materialTimeoutMs: number;
  barrierOpenUrl: string;
  barrierCloseUrl: string;
  barrierAutoCloseSeconds: number;
  barrierManualOpenEnabled: boolean;
  hasMaterialPassword: boolean;
}

interface ProbeResult {
  ok: boolean;
  message: string;
}

const EMPTY: Settings = {
  productionApiUrl: '',
  productionSyncDays: 7,
  productionCron: '30 6 * * *',
  productionTimeoutMs: 30000,
  materialApiUrl: '',
  materialUsername: '',
  materialPlant: '1500',
  materialSyncDays: 7,
  materialCron: '0 6 * * *',
  materialTimeoutMs: 30000,
  barrierOpenUrl: '',
  barrierCloseUrl: '',
  barrierAutoCloseSeconds: 5,
  barrierManualOpenEnabled: false,
  hasMaterialPassword: false
};

export default function SettingsPage() {
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && user?.role === 'ADMIN';

  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult | 'testing'>>({});

  const jsonHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...authHeaders()
  }), []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`, { headers: jsonHeaders() });
      if (!res.ok) return;
      setSettings(await res.json());
    } catch {
      // The page renders with defaults; the save attempt will surface the real error.
    } finally {
      setLoading(false);
    }
  }, [jsonHeaders]);

  useEffect(() => {
    if (isAdmin) fetchSettings();
    else setLoading(false);
  }, [isAdmin, fetchSettings]);

  const update = (key: keyof Settings, value: string | boolean) => {
    setSettings((current) => ({ ...current, [key]: value as never }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const runProbe = async (target: 'production' | 'material') => {
    setProbes((current) => ({ ...current, [target]: 'testing' }));
    try {
      const res = await fetch(`${API_URL}/api/settings/test`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ target })
      });
      const body = await res.json();
      setProbes((current) => ({ ...current, [target]: { ok: !!body.ok, message: body.message || 'No response' } }));
    } catch (error) {
      setProbes((current) => ({
        ...current,
        [target]: { ok: false, message: error instanceof Error ? error.message : 'Request failed' }
      }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    setFieldErrors({});

    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({
          productionApiUrl: settings.productionApiUrl,
          productionSyncDays: Number(settings.productionSyncDays),
          productionCron: settings.productionCron,
          productionTimeoutMs: Number(settings.productionTimeoutMs),
          materialApiUrl: settings.materialApiUrl,
          materialUsername: settings.materialUsername,
          ...(password ? { materialPassword: password } : {}),
          materialPlant: settings.materialPlant,
          materialSyncDays: Number(settings.materialSyncDays),
          materialCron: settings.materialCron,
          materialTimeoutMs: Number(settings.materialTimeoutMs),
          barrierOpenUrl: settings.barrierOpenUrl,
          barrierCloseUrl: settings.barrierCloseUrl,
          barrierAutoCloseSeconds: Number(settings.barrierAutoCloseSeconds),
          barrierManualOpenEnabled: settings.barrierManualOpenEnabled
        })
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        if (body?.fieldErrors) {
          setFieldErrors(body.fieldErrors);
          setNotice({ type: 'error', message: 'Nothing was saved. Fix the highlighted fields.' });
        } else {
          setNotice({ type: 'error', message: body?.error || `Save failed (${res.status})` });
        }
        return;
      }

      setSettings(body);
      setPassword('');
      setNotice({ type: 'success', message: 'Settings saved. Schedules were re-registered immediately.' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const renderProbe = (target: 'production' | 'material') => {
    const result = probes[target];
    if (!result) return null;

    return (
      <div
        className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
          result === 'testing'
            ? 'border-slate-200 bg-slate-50 text-slate-500'
            : result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
        }`}
      >
        {result === 'testing' ? (
          <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : result.ok ? (
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
        ) : (
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
        )}
        <span className="leading-relaxed">
          {result === 'testing' ? 'Contacting upstream...' : result.message}
        </span>
      </div>
    );
  };

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Settings are available to administrators only.
      </div>
    );
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Integration endpoints and sync schedules for the plant upstreams"
        actions={
          <Button onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
            Save Changes
          </Button>
        }
      />

      {notice && (
        <div
          className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
            notice.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="text-xs leading-relaxed">{notice.message}</span>
        </div>
      )}

      <SectionCard
        title="Production Order Upstream"
        description="Source of assembly stage data for the Assembly Line page"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runProbe('production')}
            icon={<PlugZap className="w-3.5 h-3.5" />}
            loading={probes.production === 'testing'}
          >
            Test Connection
          </Button>
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="API URL"
              value={settings.productionApiUrl}
              onChange={(e) => update('productionApiUrl', e.target.value)}
              error={fieldErrors.productionApiUrl}
              placeholder="http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST"
            />
          </div>
          <Input
            label="Sync Window (days)"
            type="number"
            min={1}
            max={31}
            value={settings.productionSyncDays}
            onChange={(e) => update('productionSyncDays', e.target.value)}
            error={fieldErrors.productionSyncDays}
            hint={`Reads the last ${settings.productionSyncDays} day(s) ending today, de-duplicating repeated orders`}
          />
          <Input
            label="Schedule (cron)"
            value={settings.productionCron}
            onChange={(e) => update('productionCron', e.target.value)}
            error={fieldErrors.productionCron}
            hint="5 fields, e.g. 30 6 * * * runs daily at 06:30"
          />
          <Input
            label="Request Timeout (ms)"
            type="number"
            value={settings.productionTimeoutMs}
            onChange={(e) => update('productionTimeoutMs', e.target.value)}
            error={fieldErrors.productionTimeoutMs}
          />
        </div>
        {renderProbe('production')}
      </SectionCard>

      <SectionCard
        title="Material Master Upstream"
        description="Source of FERT material and CONF_MATERIAL reference data"
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runProbe('material')}
            icon={<PlugZap className="w-3.5 h-3.5" />}
            loading={probes.material === 'testing'}
          >
            Test Connection
          </Button>
        }
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="API URL"
              value={settings.materialApiUrl}
              onChange={(e) => update('materialApiUrl', e.target.value)}
              error={fieldErrors.materialApiUrl}
              placeholder="http://172.16.1.4:8006/sap/bc/zsap_data_api"
            />
          </div>
          <Input
            label="Username"
            value={settings.materialUsername}
            onChange={(e) => update('materialUsername', e.target.value)}
            error={fieldErrors.materialUsername}
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.materialPassword}
            placeholder={settings.hasMaterialPassword ? 'Unchanged - leave blank to keep' : 'Not set'}
            hint="Stored on the server and never sent back to the browser"
          />
          <Input
            label="Plant"
            value={settings.materialPlant}
            onChange={(e) => update('materialPlant', e.target.value)}
            error={fieldErrors.materialPlant}
          />
          <Input
            label="Sync Window (days)"
            type="number"
            min={1}
            max={31}
            value={settings.materialSyncDays}
            onChange={(e) => update('materialSyncDays', e.target.value)}
            error={fieldErrors.materialSyncDays}
          />
          <Input
            label="Schedule (cron)"
            value={settings.materialCron}
            onChange={(e) => update('materialCron', e.target.value)}
            error={fieldErrors.materialCron}
            hint="5 fields, e.g. 0 6 * * * runs daily at 06:00"
          />
          <Input
            label="Request Timeout (ms)"
            type="number"
            value={settings.materialTimeoutMs}
            onChange={(e) => update('materialTimeoutMs', e.target.value)}
            error={fieldErrors.materialTimeoutMs}
          />
        </div>
        {renderProbe('material')}
      </SectionCard>

      <SectionCard
        title="Gate Boom Barrier"
        description="Endpoints the gate tab calls to raise and lower the barrier. The barrier controller sits on the gate tab's Wi-Fi, so this server never contacts it directly - it only stores these URLs for the tab."
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Open URL"
              value={settings.barrierOpenUrl}
              onChange={(e) => update('barrierOpenUrl', e.target.value)}
              error={fieldErrors.barrierOpenUrl}
              placeholder="http://192.168.1.50/relay/open"
              hint="Fired by the tab when a driver is authorized. Leave blank to keep the gate in demo mode."
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Close URL"
              value={settings.barrierCloseUrl}
              onChange={(e) => update('barrierCloseUrl', e.target.value)}
              error={fieldErrors.barrierCloseUrl}
              placeholder="http://192.168.1.50/relay/close"
              hint="Fired by the tab on the Close Barrier button or when the auto-close timer runs out."
            />
          </div>
          <Input
            label="Auto-close (seconds)"
            type="number"
            min={0}
            max={300}
            value={settings.barrierAutoCloseSeconds}
            onChange={(e) => update('barrierAutoCloseSeconds', e.target.value)}
            error={fieldErrors.barrierAutoCloseSeconds}
            hint="0 disables auto-close; the barrier stays open until Close Barrier is clicked"
          />
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <input
              type="checkbox"
              id="barrierManualOpenEnabled"
              checked={settings.barrierManualOpenEnabled}
              onChange={(e) => update('barrierManualOpenEnabled', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <label htmlFor="barrierManualOpenEnabled" className="block text-xs font-medium text-slate-800">
                Enable manual open button on the gate screen
              </label>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Shows a Manual Open Barrier button that raises the barrier without a driver
                scan. The button only appears when an Open URL is configured, and manual opens
                follow the auto-close setting above.
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Saving re-registers both scheduled jobs straight away, so a new schedule takes effect
        without restarting the server. Use Test Connection before syncing - the plant hosts are only
        reachable from the office LAN, not from guest Wi-Fi.
      </p>
    </div>
  );
}

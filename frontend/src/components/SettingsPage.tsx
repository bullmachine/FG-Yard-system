'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, PlugZap, AlertCircle, CheckCircle2, Loader2, Mail, KeyRound, Copy } from 'lucide-react';
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
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  hasSmtpPassword: boolean;
  dispatchAlertEmails: string;
  dispatchAlertHours: number;
  dispatchReminderHours: number;
  dispatchAlertEnabled: boolean;
  mainGateApiKey: string;
  securityVerifyRequired: boolean;
  inTransitAlertMinutes: number;
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
  hasMaterialPassword: false,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  hasSmtpPassword: false,
  dispatchAlertEmails: '',
  dispatchAlertHours: 8,
  dispatchReminderHours: 8,
  dispatchAlertEnabled: true,
  mainGateApiKey: '',
  securityVerifyRequired: true,
  inTransitAlertMinutes: 30
};

export default function SettingsPage() {
  const { isAuthenticated, user } = useAuth();
  const isAdmin = isAuthenticated && user?.role === 'ADMIN';

  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [password, setPassword] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
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

  const runProbe = async (target: 'production' | 'material' | 'email') => {
    setProbes((current) => ({ ...current, [target]: 'testing' }));
    try {
      const res = await fetch(`${API_URL}/api/settings/test`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(target === 'email' ? { target, to: testTo } : { target })
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
          barrierManualOpenEnabled: settings.barrierManualOpenEnabled,
          smtpHost: settings.smtpHost,
          smtpPort: Number(settings.smtpPort),
          smtpSecure: settings.smtpSecure,
          smtpUser: settings.smtpUser,
          smtpFrom: settings.smtpFrom,
          ...(smtpPassword ? { smtpPassword } : {}),
          dispatchAlertEmails: settings.dispatchAlertEmails,
          dispatchAlertHours: Number(settings.dispatchAlertHours),
          dispatchReminderHours: Number(settings.dispatchReminderHours),
          dispatchAlertEnabled: settings.dispatchAlertEnabled,
          securityVerifyRequired: settings.securityVerifyRequired,
          inTransitAlertMinutes: Number(settings.inTransitAlertMinutes)
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
      setSmtpPassword('');
      setNotice({ type: 'success', message: 'Settings saved. Schedules were re-registered immediately.' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = async (clear: boolean) => {
    if (!window.confirm(clear
      ? 'Switch off the main gate API? The main gate system will no longer be able to update machines.'
      : 'Create a new API key? The old key stops working at once, so the main gate team must be given the new one.')) return;
    setKeyBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_URL}/api/settings/main-gate-key`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ clear }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setNotice({ type: 'error', message: body?.error || `Failed (${res.status})` }); return; }
      setSettings((current) => ({ ...current, mainGateApiKey: body.mainGateApiKey }));
      setNotice({ type: 'success', message: clear ? 'Main gate API switched off.' : 'New API key created. Give it to the main gate team.' });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Request failed' });
    } finally {
      setKeyBusy(false);
    }
  };

  const renderProbe = (target: 'production' | 'material' | 'email') => {
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
          {result === 'testing' ? (target === 'email' ? 'Sending...' : 'Contacting upstream...') : result.message}
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

      <SectionCard
        title="E-mail (SMTP)"
        description="Mailbox used to send alerts. For Gmail use smtp.gmail.com, port 587, and a Google App Password (not the normal password)."
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label="SMTP Server"
            value={settings.smtpHost}
            onChange={(e) => update('smtpHost', e.target.value)}
            error={fieldErrors.smtpHost}
            placeholder="smtp.gmail.com"
          />
          <Input
            label="Port"
            type="number"
            value={settings.smtpPort}
            onChange={(e) => update('smtpPort', e.target.value)}
            error={fieldErrors.smtpPort}
            hint="587 (STARTTLS) or 465 (SSL)"
          />
          <Input
            label="Sender Mailbox (login)"
            value={settings.smtpUser}
            onChange={(e) => update('smtpUser', e.target.value)}
            error={fieldErrors.smtpUser}
            placeholder="alerts@example.com"
          />
          <Input
            label="Password / App Password"
            type="password"
            value={smtpPassword}
            onChange={(e) => setSmtpPassword(e.target.value)}
            error={fieldErrors.smtpPassword}
            placeholder={settings.hasSmtpPassword ? 'Unchanged - leave blank to keep' : 'Not set - no e-mail is sent until this is entered'}
            hint="Stored on the server and never sent back to the browser"
          />
          <Input
            label="From Address"
            value={settings.smtpFrom}
            onChange={(e) => update('smtpFrom', e.target.value)}
            error={fieldErrors.smtpFrom}
            hint="Usually the same as the sender mailbox"
          />
          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <input
              type="checkbox"
              id="smtpSecure"
              checked={settings.smtpSecure}
              onChange={(e) => update('smtpSecure', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="smtpSecure" className="text-xs text-slate-700">
              Use SSL from the start (port 465). Leave off for port 587.
            </label>
          </div>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label="Send a test e-mail to" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            </div>
            <Button
              variant="secondary"
              onClick={() => runProbe('email')}
              disabled={!testTo.trim()}
              loading={probes.email === 'testing'}
              icon={<Mail className="w-3.5 h-3.5" />}
            >
              Send Test
            </Button>
          </div>
          <p className="sm:col-span-2 text-[11px] text-slate-500">Save Changes first; the test uses the saved settings.</p>
        </div>
        {renderProbe('email')}
      </SectionCard>

      <SectionCard
        title="Parking & Security Check"
        description="After the driver confirms parking, security verifies the machine in its slot. Only verified machines count as free stock and can be planned for dispatch."
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <input
              type="checkbox"
              id="securityVerifyRequired"
              checked={settings.securityVerifyRequired}
              onChange={(e) => update('securityVerifyRequired', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="securityVerifyRequired" className="text-xs text-slate-700">
              Security must verify every parked machine (recommended).
            </label>
          </div>
          {!settings.securityVerifyRequired && (
            <p className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Security check is off. A confirmed park is verified automatically and recorded as &quot;Auto-verified&quot; in the security history.
              Machines already waiting in the security queue still need a decision.
            </p>
          )}
          <Input
            label="Alert if not confirmed parked after (minutes)"
            type="number"
            min={0}
            max={1440}
            value={settings.inTransitAlertMinutes}
            onChange={(e) => update('inTransitAlertMinutes', e.target.value)}
            error={fieldErrors.inTransitAlertMinutes}
            hint="Time from gate IN. Alerts the yard office and the driver. 0 = off"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Dispatch Overdue Alert"
        description="E-mail when a machine has gone out of the FG yard but not out of the main gate within the set time. Checked every 15 minutes."
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label="Send to (production manager)"
              value={settings.dispatchAlertEmails}
              onChange={(e) => update('dispatchAlertEmails', e.target.value)}
              error={fieldErrors.dispatchAlertEmails}
              placeholder="manager@example.com, another@example.com"
              hint="Separate several addresses with commas"
            />
          </div>
          <Input
            label="Alert after (hours)"
            type="number"
            min={1}
            max={72}
            value={settings.dispatchAlertHours}
            onChange={(e) => update('dispatchAlertHours', e.target.value)}
            error={fieldErrors.dispatchAlertHours}
            hint="Time from FG gate-out without main gate-out"
          />
          <Input
            label="Remind every (hours)"
            type="number"
            min={0}
            max={72}
            value={settings.dispatchReminderHours}
            onChange={(e) => update('dispatchReminderHours', e.target.value)}
            error={fieldErrors.dispatchReminderHours}
            hint="0 = alert once only"
          />
          <div className="sm:col-span-2 flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <input
              type="checkbox"
              id="dispatchAlertEnabled"
              checked={settings.dispatchAlertEnabled}
              onChange={(e) => update('dispatchAlertEnabled', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="dispatchAlertEnabled" className="text-xs text-slate-700">
              Send overdue alerts. The in-app notification is shown even when the e-mail cannot be sent.
            </label>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Main Gate Integration"
        description="Lets the main gate software mark machines out of the plant automatically. It sends this key in the x-api-key header."
        action={
          <div className="flex gap-2">
            {settings.mainGateApiKey && (
              <Button size="sm" variant="ghost" onClick={() => rotateKey(true)} loading={keyBusy}>Switch Off</Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => rotateKey(false)} loading={keyBusy} icon={<KeyRound className="w-3.5 h-3.5" />}>
              {settings.mainGateApiKey ? 'New Key' : 'Create Key'}
            </Button>
          </div>
        }
      >
        {settings.mainGateApiKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <code className="min-w-0 flex-1 break-all text-xs text-slate-800">{settings.mainGateApiKey}</code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { navigator.clipboard?.writeText(settings.mainGateApiKey).catch(() => undefined); }}
                icon={<Copy className="w-3.5 h-3.5" />}
                aria-label="Copy API key"
              />
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-[11px] leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-800">For the main gate software team</p>
              <p className="mt-1"><code>POST {API_URL}/api/integrations/main-gate/out</code></p>
              <p>Header <code>x-api-key: &lt;key above&gt;</code>, JSON body <code>{'{ "serialNumber": "...", "reference": "..." }'}</code> (or <code>barcode</code> instead of <code>serialNumber</code>; <code>reference</code> is optional, e.g. invoice or gate pass number).</p>
              <p className="mt-1"><code>GET {API_URL}/api/integrations/main-gate/pending</code> lists machines out of the FG yard that are waiting for main gate-out.</p>
              <p className="mt-1">Sending the same machine twice is harmless.</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">The API is switched off. Click Create Key when the main gate team is ready to connect.</p>
        )}
      </SectionCard>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Saving re-registers both scheduled jobs straight away, so a new schedule takes effect
        without restarting the server. Use Test Connection before syncing - the plant hosts are only
        reachable from the office LAN, not from guest Wi-Fi.
      </p>
    </div>
  );
}

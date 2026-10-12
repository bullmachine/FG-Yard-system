import cron from 'node-cron';
import prisma from '../lib/prisma';

const SINGLETON_ID = 'singleton';

export interface SystemSettings {
  productionApiUrl: string;
  productionSyncDays: number;
  productionCron: string;
  productionTimeoutMs: number;
  materialApiUrl: string;
  materialUsername: string;
  materialPassword: string;
  materialPlant: string;
  materialSyncDays: number;
  materialCron: string;
  materialTimeoutMs: number;
  barrierOpenUrl: string;
  barrierCloseUrl: string;
  barrierAutoCloseSeconds: number;
  barrierManualOpenEnabled: boolean;
}

/**
 * Bootstrap values used only when the settings row is created for the first time. The
 * production host defaults to the real plant server (192.168.1.103) - the old
 * 192.168.1.102 development host is deliberately not referenced anywhere.
 */
function bootstrapDefaults(): SystemSettings {
  return {
    productionApiUrl:
      process.env.PRODUCTION_API_URL ||
      'http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST',
    productionSyncDays: 7,
    productionCron: '30 6 * * *',
    productionTimeoutMs: 30000,
    materialApiUrl:
      process.env.MATERIAL_MASTER_API_URL || 'http://172.16.1.4:8006/sap/bc/zsap_data_api',
    materialUsername: process.env.MATERIAL_MASTER_USERNAME || 'RFCDF',
    materialPassword: process.env.MATERIAL_MASTER_PASSWORD || '',
    materialPlant: process.env.MATERIAL_MASTER_PLANT || '1500',
    materialSyncDays: 7,
    materialCron: '0 6 * * *',
    materialTimeoutMs: 30000,
    barrierOpenUrl: '',
    barrierCloseUrl: '',
    barrierAutoCloseSeconds: 5,
    barrierManualOpenEnabled: false
  };
}

let cache: SystemSettings | null = null;
let rescheduleHandler: (() => void | Promise<void>) | null = null;

/**
 * Registered by the scheduler so a settings save can re-register the cron jobs without
 * this service having to import the scheduler (which would be a circular import).
 */
export function onSettingsChanged(handler: () => void | Promise<void>): void {
  rescheduleHandler = handler;
}

function rowToSettings(row: {
  productionApiUrl: string;
  productionSyncDays: number;
  productionCron: string;
  productionTimeoutMs: number;
  materialApiUrl: string;
  materialUsername: string;
  materialPassword: string;
  materialPlant: string;
  materialSyncDays: number;
  materialCron: string;
  materialTimeoutMs: number;
  barrierOpenUrl: string;
  barrierCloseUrl: string;
  barrierAutoCloseSeconds: number;
  barrierManualOpenEnabled: boolean;
}): SystemSettings {
  return {
    productionApiUrl: row.productionApiUrl,
    productionSyncDays: row.productionSyncDays,
    productionCron: row.productionCron,
    productionTimeoutMs: row.productionTimeoutMs,
    materialApiUrl: row.materialApiUrl,
    materialUsername: row.materialUsername,
    materialPassword: row.materialPassword,
    materialPlant: row.materialPlant,
    materialSyncDays: row.materialSyncDays,
    materialCron: row.materialCron,
    materialTimeoutMs: row.materialTimeoutMs,
    barrierOpenUrl: row.barrierOpenUrl,
    barrierCloseUrl: row.barrierCloseUrl,
    barrierAutoCloseSeconds: row.barrierAutoCloseSeconds,
    barrierManualOpenEnabled: row.barrierManualOpenEnabled
  };
}

async function ensureRow(): Promise<void> {
  const existing = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return;

  const defaults = bootstrapDefaults();
  await prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...defaults },
    update: {}
  });
  console.log('System settings row created with defaults');
}

/**
 * Load settings into the cache. Called once at boot before the scheduler starts so the
 * first cron registration uses the stored values rather than the defaults.
 */
export async function init(): Promise<SystemSettings> {
  await ensureRow();

  const row = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  cache = row ? rowToSettings(row) : bootstrapDefaults();

  console.log(
    `System settings loaded (production sync every "${cache.productionCron}", material every "${cache.materialCron}")`
  );

  return cache;
}

export async function getSettings(): Promise<SystemSettings> {
  if (cache) return cache;
  return init();
}

export interface SettingsUpdate {
  productionApiUrl?: string;
  productionSyncDays?: number;
  productionCron?: string;
  productionTimeoutMs?: number;
  materialApiUrl?: string;
  materialUsername?: string;
  materialPassword?: string;
  materialPlant?: string;
  materialSyncDays?: number;
  materialCron?: string;
  materialTimeoutMs?: number;
  barrierOpenUrl?: string;
  barrierCloseUrl?: string;
  barrierAutoCloseSeconds?: number;
  barrierManualOpenEnabled?: boolean;
}

/**
 * Persist a partial settings change and refresh the cache. A blank material password is
 * ignored so the stored credential is never blanked out by an unrelated edit.
 */
export async function updateSettings(
  update: SettingsUpdate,
  updatedById?: string
): Promise<SystemSettings> {
  await ensureRow();

  const current = await getSettings();
  const next: SystemSettings = {
    productionApiUrl: update.productionApiUrl ?? current.productionApiUrl,
    productionSyncDays: update.productionSyncDays ?? current.productionSyncDays,
    productionCron: update.productionCron ?? current.productionCron,
    productionTimeoutMs: update.productionTimeoutMs ?? current.productionTimeoutMs,
    materialApiUrl: update.materialApiUrl ?? current.materialApiUrl,
    materialUsername: update.materialUsername ?? current.materialUsername,
    materialPassword: update.materialPassword ? update.materialPassword : current.materialPassword,
    materialPlant: update.materialPlant ?? current.materialPlant,
    materialSyncDays: update.materialSyncDays ?? current.materialSyncDays,
    materialCron: update.materialCron ?? current.materialCron,
    materialTimeoutMs: update.materialTimeoutMs ?? current.materialTimeoutMs,
    barrierOpenUrl: update.barrierOpenUrl ?? current.barrierOpenUrl,
    barrierCloseUrl: update.barrierCloseUrl ?? current.barrierCloseUrl,
    barrierAutoCloseSeconds: update.barrierAutoCloseSeconds ?? current.barrierAutoCloseSeconds,
    barrierManualOpenEnabled: update.barrierManualOpenEnabled ?? current.barrierManualOpenEnabled
  };

  await prisma.systemSetting.update({
    where: { id: SINGLETON_ID },
    data: { ...next, updatedById: updatedById ?? null }
  });

  cache = next;

  if (rescheduleHandler) {
    try {
      await rescheduleHandler();
    } catch (error) {
      // A reschedule failure must not lose the saved settings.
      console.error('Failed to reschedule jobs after settings update:', error);
    }
  }

  return next;
}

/**
 * Settings without the stored credential, safe to send to a client.
 */
export function toPublicSettings(settings: SystemSettings) {
  return {
    productionApiUrl: settings.productionApiUrl,
    productionSyncDays: settings.productionSyncDays,
    productionCron: settings.productionCron,
    productionTimeoutMs: settings.productionTimeoutMs,
    materialApiUrl: settings.materialApiUrl,
    materialUsername: settings.materialUsername,
    materialPlant: settings.materialPlant,
    materialSyncDays: settings.materialSyncDays,
    materialCron: settings.materialCron,
    materialTimeoutMs: settings.materialTimeoutMs,
    barrierOpenUrl: settings.barrierOpenUrl,
    barrierCloseUrl: settings.barrierCloseUrl,
    barrierAutoCloseSeconds: settings.barrierAutoCloseSeconds,
    barrierManualOpenEnabled: settings.barrierManualOpenEnabled,
    hasMaterialPassword: Boolean(settings.materialPassword)
  };
}

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

import { purgeOldLoginEvents } from './loginHistoryService';
import { backupConfig, runBackup } from './backupService';
import cron from 'node-cron';
import { syncProductionOrders, syncProductionOrderWindow } from './syncService';
import { syncMaterialMaster } from './materialMasterService';
import { notifyEvent } from './notificationService';
import { getSettings, onSettingsChanged } from './settingsService';
import { checkOverdueDispatch } from './dispatchAlertService';
import { checkStuckInTransit } from './inTransitAlertService';

const SYNC_LINKS: Record<string, string> = {
  'Production order': 'assembly',
  'Material master': 'materials'
};

/**
 * Only a real error count as a failure. Days with no published orders are tracked in
 * emptyDays and are normal, so they never raise an alert.
 */
async function alertIfSyncFailed(label: string, result: any): Promise<void> {
  const errors: string[] = Array.isArray(result?.errors) ? result.errors : [];
  if (errors.length === 0) return;

  await notifyEvent({
    type: 'SYNC_FAILED',
    severity: 'CRITICAL',
    title: `${label} sync failed`,
    message: errors[0],
    link: SYNC_LINKS[label] || 'dashboard'
  });
}

let isSyncing = false;
let lastSyncResult: any = null;

let isMaterialSyncing = false;
let lastMaterialSyncResult: any = null;

// Task handles are retained so a settings change can cancel and re-register them.
// Stopping a task only cancels future triggers, so a sync already running finishes
// normally and the isSyncing guard below still prevents overlapping runs.
let productionTask: cron.ScheduledTask | null = null;
let materialTask: cron.ScheduledTask | null = null;

let activeProductionCron = '';
let activeMaterialCron = '';

async function runProductionSync(trigger: string): Promise<void> {
  if (isSyncing) {
    console.log('Sync already in progress, skipping...');
    return;
  }

  isSyncing = true;
  console.log(`[${new Date().toISOString()}] Starting ${trigger} sync...`);

  try {
    lastSyncResult = await syncProductionOrderWindow();
    console.log(`[${new Date().toISOString()}] Sync completed:`, lastSyncResult);
    await alertIfSyncFailed('Production order', lastSyncResult);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Sync failed:`, error);
    lastSyncResult = { error: String(error) };
    await alertIfSyncFailed('Production order', { errors: [String(error)] });
  } finally {
    isSyncing = false;
  }
}

async function runMaterialMasterSync(trigger: string): Promise<void> {
  if (isMaterialSyncing) {
    console.log('Material master sync already in progress, skipping...');
    return;
  }

  isMaterialSyncing = true;
  console.log(`[${new Date().toISOString()}] Starting ${trigger} material master sync...`);

  try {
    lastMaterialSyncResult = await syncMaterialMaster();
    console.log(`[${new Date().toISOString()}] Material master sync completed:`, lastMaterialSyncResult);
    await alertIfSyncFailed('Material master', lastMaterialSyncResult);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Material master sync failed:`, error);
    lastMaterialSyncResult = { error: String(error) };
    await alertIfSyncFailed('Material master', { errors: [String(error)] });
  } finally {
    isMaterialSyncing = false;
  }
}

/**
 * Cancel any existing jobs and register both from the given cron expressions.
 * Callers validate the expressions before calling this.
 */
function applySchedule(productionCron: string, materialCron: string): void {
  productionTask?.stop();
  materialTask?.stop();

  productionTask = cron.schedule(productionCron, () => {
    void runProductionSync('scheduled');
  });

  materialTask = cron.schedule(materialCron, () => {
    void runMaterialMasterSync('scheduled');
  });

  activeProductionCron = productionCron;
  activeMaterialCron = materialCron;

  console.log(`Production order sync scheduled with cron: ${productionCron}`);
  console.log(`Material master sync scheduled with cron: ${materialCron}`);
}

/**
 * Re-read the settings and re-register the jobs. Wired to settingsService so saving
 * new cron expressions takes effect immediately without a restart.
 */
export async function rescheduleScheduler(): Promise<void> {
  const settings = await getSettings();
  applySchedule(settings.productionCron, settings.materialCron);
}

/**
 * Start the scheduler using the stored cron expressions.
 */
export async function startScheduler(): Promise<void> {
  onSettingsChanged(() => rescheduleScheduler());

  const settings = await getSettings();
  applySchedule(settings.productionCron, settings.materialCron);

  // Overdue dispatch check: fixed 15-minute cadence; the thresholds live in Settings.
  cron.schedule('*/15 * * * *', () => {
    checkOverdueDispatch().catch((error) => console.error('Overdue dispatch check failed:', error));
  });

  // Stuck-in-transit check: every 5 minutes; the threshold lives in Settings.
  cron.schedule('*/5 * * * *', () => {
    checkStuckInTransit().catch((error) => console.error('In-transit check failed:', error));
  });

  // Login history older than the retention period is deleted every night at 02:30.
  cron.schedule('30 2 * * *', () => {
    purgeOldLoginEvents().catch((error) => console.error('Login history clean-up failed:', error));
  });
  purgeOldLoginEvents().catch((error) => console.error('Login history clean-up failed:', error));

  // Database backup into BACKUP_DIR (backupService), every night by default.
  const backup = backupConfig();
  if (cron.validate(backup.cron)) {
    cron.schedule(backup.cron, () => {
      void runBackup('scheduled');
    });
    console.log(`Database backup scheduled with cron: ${backup.cron} into ${backup.dir}`);
  } else {
    console.error(`BACKUP_CRON "${backup.cron}" is not a valid cron expression; daily backup is OFF`);
  }

  console.log('Scheduler started successfully');
}

/**
 * Trigger manual material master sync
 */
export async function triggerMaterialMasterSync(fromDt?: string, toDt?: string): Promise<any> {
  if (isMaterialSyncing) {
    return { error: 'Material master sync already in progress' };
  }

  isMaterialSyncing = true;
  console.log(`[${new Date().toISOString()}] Starting manual material master sync...`);

  try {
    lastMaterialSyncResult = await syncMaterialMaster(fromDt, toDt);
    console.log(`[${new Date().toISOString()}] Manual material master sync completed:`, lastMaterialSyncResult);
    await alertIfSyncFailed('Material master', lastMaterialSyncResult);
    return lastMaterialSyncResult;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Manual material master sync failed:`, error);
    lastMaterialSyncResult = { error: String(error) };
    await alertIfSyncFailed('Material master', { errors: [String(error)] });
    return lastMaterialSyncResult;
  } finally {
    isMaterialSyncing = false;
  }
}

/**
 * Trigger manual sync
 */
export async function triggerManualSync(date?: string): Promise<any> {
  if (isSyncing) {
    return { error: 'Sync already in progress' };
  }

  isSyncing = true;
  console.log(`[${new Date().toISOString()}] Starting manual sync...`);

  try {
    const result = date
      ? await syncProductionOrders(date)
      : await syncProductionOrderWindow();

    lastSyncResult = result;
    console.log(`[${new Date().toISOString()}] Manual sync completed:`, result);
    await alertIfSyncFailed('Production order', result);
    return result;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Manual sync failed:`, error);
    lastSyncResult = { error: String(error) };
    await alertIfSyncFailed('Production order', { errors: [String(error)] });
    return lastSyncResult;
  } finally {
    isSyncing = false;
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    isSyncing,
    lastSyncResult,
    cronExpression: activeProductionCron,
    materialMaster: {
      isSyncing: isMaterialSyncing,
      lastSyncResult: lastMaterialSyncResult,
      cronExpression: activeMaterialCron
    }
  };
}

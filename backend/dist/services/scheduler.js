"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rescheduleScheduler = rescheduleScheduler;
exports.startScheduler = startScheduler;
exports.triggerMaterialMasterSync = triggerMaterialMasterSync;
exports.triggerManualSync = triggerManualSync;
exports.getSchedulerStatus = getSchedulerStatus;
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_1 = require("./syncService");
const materialMasterService_1 = require("./materialMasterService");
const notificationService_1 = require("./notificationService");
const settingsService_1 = require("./settingsService");
const SYNC_LINKS = {
    'Production order': 'assembly',
    'Material master': 'materials'
};
/**
 * Only a real error count as a failure. Days with no published orders are tracked in
 * emptyDays and are normal, so they never raise an alert.
 */
async function alertIfSyncFailed(label, result) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    if (errors.length === 0)
        return;
    await (0, notificationService_1.notifyEvent)({
        type: 'SYNC_FAILED',
        severity: 'CRITICAL',
        title: `${label} sync failed`,
        message: errors[0],
        link: SYNC_LINKS[label] || 'dashboard'
    });
}
let isSyncing = false;
let lastSyncResult = null;
let isMaterialSyncing = false;
let lastMaterialSyncResult = null;
// Task handles are retained so a settings change can cancel and re-register them.
// Stopping a task only cancels future triggers, so a sync already running finishes
// normally and the isSyncing guard below still prevents overlapping runs.
let productionTask = null;
let materialTask = null;
let activeProductionCron = '';
let activeMaterialCron = '';
async function runProductionSync(trigger) {
    if (isSyncing) {
        console.log('Sync already in progress, skipping...');
        return;
    }
    isSyncing = true;
    console.log(`[${new Date().toISOString()}] Starting ${trigger} sync...`);
    try {
        lastSyncResult = await (0, syncService_1.syncProductionOrderWindow)();
        console.log(`[${new Date().toISOString()}] Sync completed:`, lastSyncResult);
        await alertIfSyncFailed('Production order', lastSyncResult);
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] Sync failed:`, error);
        lastSyncResult = { error: String(error) };
        await alertIfSyncFailed('Production order', { errors: [String(error)] });
    }
    finally {
        isSyncing = false;
    }
}
async function runMaterialMasterSync(trigger) {
    if (isMaterialSyncing) {
        console.log('Material master sync already in progress, skipping...');
        return;
    }
    isMaterialSyncing = true;
    console.log(`[${new Date().toISOString()}] Starting ${trigger} material master sync...`);
    try {
        lastMaterialSyncResult = await (0, materialMasterService_1.syncMaterialMaster)();
        console.log(`[${new Date().toISOString()}] Material master sync completed:`, lastMaterialSyncResult);
        await alertIfSyncFailed('Material master', lastMaterialSyncResult);
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] Material master sync failed:`, error);
        lastMaterialSyncResult = { error: String(error) };
        await alertIfSyncFailed('Material master', { errors: [String(error)] });
    }
    finally {
        isMaterialSyncing = false;
    }
}
/**
 * Cancel any existing jobs and register both from the given cron expressions.
 * Callers validate the expressions before calling this.
 */
function applySchedule(productionCron, materialCron) {
    productionTask?.stop();
    materialTask?.stop();
    productionTask = node_cron_1.default.schedule(productionCron, () => {
        void runProductionSync('scheduled');
    });
    materialTask = node_cron_1.default.schedule(materialCron, () => {
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
async function rescheduleScheduler() {
    const settings = await (0, settingsService_1.getSettings)();
    applySchedule(settings.productionCron, settings.materialCron);
}
/**
 * Start the scheduler using the stored cron expressions.
 */
async function startScheduler() {
    (0, settingsService_1.onSettingsChanged)(() => rescheduleScheduler());
    const settings = await (0, settingsService_1.getSettings)();
    applySchedule(settings.productionCron, settings.materialCron);
    console.log('Scheduler started successfully');
}
/**
 * Trigger manual material master sync
 */
async function triggerMaterialMasterSync(fromDt, toDt) {
    if (isMaterialSyncing) {
        return { error: 'Material master sync already in progress' };
    }
    isMaterialSyncing = true;
    console.log(`[${new Date().toISOString()}] Starting manual material master sync...`);
    try {
        lastMaterialSyncResult = await (0, materialMasterService_1.syncMaterialMaster)(fromDt, toDt);
        console.log(`[${new Date().toISOString()}] Manual material master sync completed:`, lastMaterialSyncResult);
        await alertIfSyncFailed('Material master', lastMaterialSyncResult);
        return lastMaterialSyncResult;
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] Manual material master sync failed:`, error);
        lastMaterialSyncResult = { error: String(error) };
        await alertIfSyncFailed('Material master', { errors: [String(error)] });
        return lastMaterialSyncResult;
    }
    finally {
        isMaterialSyncing = false;
    }
}
/**
 * Trigger manual sync
 */
async function triggerManualSync(date) {
    if (isSyncing) {
        return { error: 'Sync already in progress' };
    }
    isSyncing = true;
    console.log(`[${new Date().toISOString()}] Starting manual sync...`);
    try {
        const result = date
            ? await (0, syncService_1.syncProductionOrders)(date)
            : await (0, syncService_1.syncProductionOrderWindow)();
        lastSyncResult = result;
        console.log(`[${new Date().toISOString()}] Manual sync completed:`, result);
        await alertIfSyncFailed('Production order', result);
        return result;
    }
    catch (error) {
        console.error(`[${new Date().toISOString()}] Manual sync failed:`, error);
        lastSyncResult = { error: String(error) };
        await alertIfSyncFailed('Production order', { errors: [String(error)] });
        return lastSyncResult;
    }
    finally {
        isSyncing = false;
    }
}
/**
 * Get scheduler status
 */
function getSchedulerStatus() {
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

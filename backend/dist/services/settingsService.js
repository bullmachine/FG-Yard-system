"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onSettingsChanged = onSettingsChanged;
exports.init = init;
exports.getSettings = getSettings;
exports.updateSettings = updateSettings;
exports.toPublicSettings = toPublicSettings;
exports.isValidCron = isValidCron;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const SINGLETON_ID = 'singleton';
/**
 * Bootstrap values used only when the settings row is created for the first time. The
 * production host defaults to the real plant server (192.168.1.103) - the old
 * 192.168.1.102 development host is deliberately not referenced anywhere.
 */
function bootstrapDefaults() {
    return {
        productionApiUrl: process.env.PRODUCTION_API_URL ||
            'http://192.168.1.103/bdf/apps/bafrestapi.php/PRODUCTION_API/REST',
        productionSyncDays: 7,
        productionCron: '30 6 * * *',
        productionTimeoutMs: 30000,
        materialApiUrl: process.env.MATERIAL_MASTER_API_URL || 'http://172.16.1.4:8006/sap/bc/zsap_data_api',
        materialUsername: process.env.MATERIAL_MASTER_USERNAME || 'RFCDF',
        materialPassword: process.env.MATERIAL_MASTER_PASSWORD || '',
        materialPlant: process.env.MATERIAL_MASTER_PLANT || '1500',
        materialSyncDays: 7,
        materialCron: '0 6 * * *',
        materialTimeoutMs: 30000
    };
}
let cache = null;
let rescheduleHandler = null;
/**
 * Registered by the scheduler so a settings save can re-register the cron jobs without
 * this service having to import the scheduler (which would be a circular import).
 */
function onSettingsChanged(handler) {
    rescheduleHandler = handler;
}
function rowToSettings(row) {
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
        materialTimeoutMs: row.materialTimeoutMs
    };
}
async function ensureRow() {
    const existing = await prisma_1.default.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
    if (existing)
        return;
    const defaults = bootstrapDefaults();
    await prisma_1.default.systemSetting.upsert({
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
async function init() {
    await ensureRow();
    const row = await prisma_1.default.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
    cache = row ? rowToSettings(row) : bootstrapDefaults();
    console.log(`System settings loaded (production sync every "${cache.productionCron}", material every "${cache.materialCron}")`);
    return cache;
}
async function getSettings() {
    if (cache)
        return cache;
    return init();
}
/**
 * Persist a partial settings change and refresh the cache. A blank material password is
 * ignored so the stored credential is never blanked out by an unrelated edit.
 */
async function updateSettings(update, updatedById) {
    await ensureRow();
    const current = await getSettings();
    const next = {
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
        materialTimeoutMs: update.materialTimeoutMs ?? current.materialTimeoutMs
    };
    await prisma_1.default.systemSetting.update({
        where: { id: SINGLETON_ID },
        data: { ...next, updatedById: updatedById ?? null }
    });
    cache = next;
    if (rescheduleHandler) {
        try {
            await rescheduleHandler();
        }
        catch (error) {
            // A reschedule failure must not lose the saved settings.
            console.error('Failed to reschedule jobs after settings update:', error);
        }
    }
    return next;
}
/**
 * Settings without the stored credential, safe to send to a client.
 */
function toPublicSettings(settings) {
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
        hasMaterialPassword: Boolean(settings.materialPassword)
    };
}
function isValidCron(expression) {
    return node_cron_1.default.validate(expression);
}

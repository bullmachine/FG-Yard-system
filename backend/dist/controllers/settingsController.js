"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testConnectionHandler = exports.updateSettingsHandler = exports.getSettingsHandler = void 0;
const settingsService_1 = require("../services/settingsService");
const productionApiService_1 = require("../services/productionApiService");
const materialMasterService_1 = require("../services/materialMasterService");
const MIN_DAYS = 1;
const MAX_DAYS = 31;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
/**
 * Validates a URL when one is supplied. Omitted fields are left untouched, so a
 * partial save (for example only the cron expression) is valid on its own.
 */
function validateUrl(value, field, errors) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !value.trim()) {
        errors[field] = 'A URL is required';
        return undefined;
    }
    const trimmed = value.trim();
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            errors[field] = 'URL must start with http:// or https://';
            return undefined;
        }
    }
    catch {
        errors[field] = 'Not a valid URL';
        return undefined;
    }
    return trimmed;
}
function validateDays(value, field, errors) {
    if (value === undefined)
        return undefined;
    const num = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (Number.isNaN(num) || !Number.isInteger(num)) {
        errors[field] = 'Must be a whole number';
        return undefined;
    }
    if (num < MIN_DAYS || num > MAX_DAYS) {
        errors[field] = `Must be between ${MIN_DAYS} and ${MAX_DAYS}`;
        return undefined;
    }
    return num;
}
function validateTimeout(value, field, errors) {
    if (value === undefined)
        return undefined;
    const num = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (Number.isNaN(num) || !Number.isInteger(num)) {
        errors[field] = 'Must be a whole number of milliseconds';
        return undefined;
    }
    if (num < MIN_TIMEOUT_MS || num > MAX_TIMEOUT_MS) {
        errors[field] = `Must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`;
        return undefined;
    }
    return num;
}
function validateCron(value, field, errors) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string' || !value.trim()) {
        errors[field] = 'A cron expression is required';
        return undefined;
    }
    const trimmed = value.trim();
    if (!(0, settingsService_1.isValidCron)(trimmed)) {
        errors[field] = 'Not a valid cron expression (expected 5 fields, e.g. "30 6 * * *")';
        return undefined;
    }
    return trimmed;
}
const getSettingsHandler = async (req, res) => {
    try {
        const settings = await (0, settingsService_1.getSettings)();
        res.json((0, settingsService_1.toPublicSettings)(settings));
    }
    catch {
        res.status(500).json({ error: 'Failed to load settings' });
    }
};
exports.getSettingsHandler = getSettingsHandler;
const updateSettingsHandler = async (req, res) => {
    const errors = {};
    const update = {};
    try {
        const body = req.body || {};
        const productionApiUrl = validateUrl(body.productionApiUrl, 'productionApiUrl', errors);
        if (productionApiUrl)
            update.productionApiUrl = productionApiUrl;
        const productionSyncDays = validateDays(body.productionSyncDays, 'productionSyncDays', errors);
        if (productionSyncDays !== undefined)
            update.productionSyncDays = productionSyncDays;
        const productionCron = validateCron(body.productionCron, 'productionCron', errors);
        if (productionCron !== undefined)
            update.productionCron = productionCron;
        const productionTimeoutMs = validateTimeout(body.productionTimeoutMs, 'productionTimeoutMs', errors);
        if (productionTimeoutMs !== undefined)
            update.productionTimeoutMs = productionTimeoutMs;
        const materialApiUrl = validateUrl(body.materialApiUrl, 'materialApiUrl', errors);
        if (materialApiUrl)
            update.materialApiUrl = materialApiUrl;
        if (body.materialUsername !== undefined) {
            if (typeof body.materialUsername !== 'string' || !body.materialUsername.trim()) {
                errors.materialUsername = 'Username is required';
            }
            else {
                update.materialUsername = body.materialUsername.trim();
            }
        }
        // Blank means "keep the stored password" so editing another field never clears it.
        if (body.materialPassword !== undefined && body.materialPassword !== '') {
            if (typeof body.materialPassword !== 'string') {
                errors.materialPassword = 'Password must be text';
            }
            else {
                update.materialPassword = body.materialPassword;
            }
        }
        if (body.materialPlant !== undefined) {
            if (typeof body.materialPlant !== 'string' || !body.materialPlant.trim()) {
                errors.materialPlant = 'Plant is required';
            }
            else {
                update.materialPlant = body.materialPlant.trim();
            }
        }
        const materialSyncDays = validateDays(body.materialSyncDays, 'materialSyncDays', errors);
        if (materialSyncDays !== undefined)
            update.materialSyncDays = materialSyncDays;
        const materialCron = validateCron(body.materialCron, 'materialCron', errors);
        if (materialCron !== undefined)
            update.materialCron = materialCron;
        const materialTimeoutMs = validateTimeout(body.materialTimeoutMs, 'materialTimeoutMs', errors);
        if (materialTimeoutMs !== undefined)
            update.materialTimeoutMs = materialTimeoutMs;
        if (Object.keys(errors).length > 0) {
            return res.status(400).json({ error: 'Validation failed', fieldErrors: errors });
        }
        const updated = await (0, settingsService_1.updateSettings)(update, req.userId);
        res.json((0, settingsService_1.toPublicSettings)(updated));
    }
    catch (error) {
        console.error('Failed to update settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};
exports.updateSettingsHandler = updateSettingsHandler;
/**
 * Read-only reachability probe. Never writes to the database.
 */
const testConnectionHandler = async (req, res) => {
    const target = req.body?.target;
    if (target !== 'production' && target !== 'material') {
        return res.status(400).json({ error: 'target must be "production" or "material"' });
    }
    try {
        const result = target === 'production'
            ? await (0, productionApiService_1.testProductionConnection)()
            : await (0, materialMasterService_1.testMaterialMasterConnection)();
        res.json({ target, ...result });
    }
    catch (error) {
        res.status(500).json({
            target,
            ok: false,
            message: error instanceof Error ? error.message : String(error)
        });
    }
};
exports.testConnectionHandler = testConnectionHandler;

import { Request, Response } from 'express';
import crypto from 'crypto';
import {
  getSettings,
  updateSettings,
  toPublicSettings,
  isValidCron,
  SettingsUpdate
} from '../services/settingsService';
import { testProductionConnection } from '../services/productionApiService';
import { testMaterialMasterConnection } from '../services/materialMasterService';
import { sendMail } from '../services/mailService';

type AuthenticatedRequest = Request & { userId?: string };

type FieldErrors = Record<string, string>;

const MIN_DAYS = 1;
const MAX_DAYS = 31;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const MAX_AUTO_CLOSE_SECONDS = 300;
const MAX_ALERT_HOURS = 72;
const EMAIL_RE = /^[^s@,;]+@[^s@,;]+.[^s@,;]+$/;

function validateWholeNumber(value: unknown, field: string, min: number, max: number, errors: FieldErrors): number | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(num) || !Number.isInteger(num) || num < min || num > max) {
    errors[field] = `Must be a whole number from ${min} to ${max}`;
    return undefined;
  }
  return num;
}

function validateEmail(value: unknown, field: string, errors: FieldErrors): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!EMAIL_RE.test(trimmed)) {
    errors[field] = 'Not a valid e-mail address';
    return undefined;
  }
  return trimmed;
}

/** Comma- or semicolon-separated list; stored comma-separated. Blank turns alerts off. */
function validateEmailList(value: unknown, field: string, errors: FieldErrors): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors[field] = 'Must be text';
    return undefined;
  }
  const list = value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean);
  const bad = list.filter((v) => !EMAIL_RE.test(v));
  if (bad.length) {
    errors[field] = `Not a valid e-mail address: ${bad.join(', ')}`;
    return undefined;
  }
  if (list.join(', ').length > 500) {
    errors[field] = 'Too many addresses (500 characters at most)';
    return undefined;
  }
  return list.join(', ');
}

/**
 * Validates a URL when one is supplied. Omitted fields are left untouched, so a
 * partial save (for example only the cron expression) is valid on its own.
 */
function validateUrl(value: unknown, field: string, errors: FieldErrors): string | undefined {
  if (value === undefined) return undefined;

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
  } catch {
    errors[field] = 'Not a valid URL';
    return undefined;
  }

  return trimmed;
}

function validateDays(value: unknown, field: string, errors: FieldErrors): number | undefined {
  if (value === undefined) return undefined;

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

function validateTimeout(value: unknown, field: string, errors: FieldErrors): number | undefined {
  if (value === undefined) return undefined;

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

function validateCron(value: unknown, field: string, errors: FieldErrors): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' || !value.trim()) {
    errors[field] = 'A cron expression is required';
    return undefined;
  }

  const trimmed = value.trim();

  if (!isValidCron(trimmed)) {
    errors[field] = 'Not a valid cron expression (expected 5 fields, e.g. "30 6 * * *")';
    return undefined;
  }

  return trimmed;
}

/**
 * The barrier URL is optional: a blank value keeps the gate in demo mode (the tab
 * does not call any controller). When one is supplied it must be a valid http(s)
 * URL, the same rule as the upstream providers.
 */
function validateOptionalUrl(
  value: unknown,
  field: string,
  errors: FieldErrors
): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const trimmed = value.trim();

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors[field] = 'URL must start with http:// or https://';
      return undefined;
    }
  } catch {
    errors[field] = 'Not a valid URL';
    return undefined;
  }

  return trimmed;
}

function validateAutoCloseSeconds(
  value: unknown,
  field: string,
  errors: FieldErrors
): number | undefined {
  if (value === undefined) return undefined;

  const num = typeof value === 'number' ? value : parseInt(String(value), 10);

  if (Number.isNaN(num) || !Number.isInteger(num)) {
    errors[field] = 'Must be a whole number of seconds';
    return undefined;
  }

  if (num < 0 || num > MAX_AUTO_CLOSE_SECONDS) {
    errors[field] = `Must be between 0 and ${MAX_AUTO_CLOSE_SECONDS} seconds`;
    return undefined;
  }

  return num;
}

export const getSettingsHandler = async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    res.json(toPublicSettings(settings));
  } catch {
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

export const updateSettingsHandler = async (req: Request, res: Response) => {
  const errors: FieldErrors = {};
  const update: SettingsUpdate = {};

  try {
    const body = req.body || {};

    const productionApiUrl = validateUrl(body.productionApiUrl, 'productionApiUrl', errors);
    if (productionApiUrl) update.productionApiUrl = productionApiUrl;

    const productionSyncDays = validateDays(body.productionSyncDays, 'productionSyncDays', errors);
    if (productionSyncDays !== undefined) update.productionSyncDays = productionSyncDays;

    const productionCron = validateCron(body.productionCron, 'productionCron', errors);
    if (productionCron !== undefined) update.productionCron = productionCron;

    const productionTimeoutMs = validateTimeout(
      body.productionTimeoutMs,
      'productionTimeoutMs',
      errors
    );
    if (productionTimeoutMs !== undefined) update.productionTimeoutMs = productionTimeoutMs;

    const materialApiUrl = validateUrl(body.materialApiUrl, 'materialApiUrl', errors);
    if (materialApiUrl) update.materialApiUrl = materialApiUrl;

    if (body.materialUsername !== undefined) {
      if (typeof body.materialUsername !== 'string' || !body.materialUsername.trim()) {
        errors.materialUsername = 'Username is required';
      } else {
        update.materialUsername = body.materialUsername.trim();
      }
    }

    // Blank means "keep the stored password" so editing another field never clears it.
    if (body.materialPassword !== undefined && body.materialPassword !== '') {
      if (typeof body.materialPassword !== 'string') {
        errors.materialPassword = 'Password must be text';
      } else {
        update.materialPassword = body.materialPassword;
      }
    }

    if (body.materialPlant !== undefined) {
      if (typeof body.materialPlant !== 'string' || !body.materialPlant.trim()) {
        errors.materialPlant = 'Plant is required';
      } else {
        update.materialPlant = body.materialPlant.trim();
      }
    }

    const materialSyncDays = validateDays(body.materialSyncDays, 'materialSyncDays', errors);
    if (materialSyncDays !== undefined) update.materialSyncDays = materialSyncDays;

    const materialCron = validateCron(body.materialCron, 'materialCron', errors);
    if (materialCron !== undefined) update.materialCron = materialCron;

    const materialTimeoutMs = validateTimeout(body.materialTimeoutMs, 'materialTimeoutMs', errors);
    if (materialTimeoutMs !== undefined) update.materialTimeoutMs = materialTimeoutMs;

    const barrierOpenUrl = validateOptionalUrl(body.barrierOpenUrl, 'barrierOpenUrl', errors);
    if (barrierOpenUrl !== undefined) update.barrierOpenUrl = barrierOpenUrl;

    const barrierCloseUrl = validateOptionalUrl(body.barrierCloseUrl, 'barrierCloseUrl', errors);
    if (barrierCloseUrl !== undefined) update.barrierCloseUrl = barrierCloseUrl;

    const barrierAutoCloseSeconds = validateAutoCloseSeconds(
      body.barrierAutoCloseSeconds,
      'barrierAutoCloseSeconds',
      errors
    );
    if (barrierAutoCloseSeconds !== undefined) update.barrierAutoCloseSeconds = barrierAutoCloseSeconds;

    if (body.barrierManualOpenEnabled !== undefined) {
      if (typeof body.barrierManualOpenEnabled !== 'boolean') {
        errors.barrierManualOpenEnabled = 'Must be a boolean';
      } else {
        update.barrierManualOpenEnabled = body.barrierManualOpenEnabled;
      }
    }

    if (body.smtpHost !== undefined) {
      if (typeof body.smtpHost !== 'string' || !body.smtpHost.trim()) {
        errors.smtpHost = 'SMTP server is required';
      } else {
        update.smtpHost = body.smtpHost.trim();
      }
    }

    const smtpPort = validateWholeNumber(body.smtpPort, 'smtpPort', 1, 65535, errors);
    if (smtpPort !== undefined) update.smtpPort = smtpPort;

    if (body.smtpSecure !== undefined) {
      if (typeof body.smtpSecure !== 'boolean') errors.smtpSecure = 'Must be a boolean';
      else update.smtpSecure = body.smtpSecure;
    }

    const smtpUser = validateEmail(body.smtpUser, 'smtpUser', errors);
    if (smtpUser !== undefined) update.smtpUser = smtpUser;

    const smtpFrom = validateEmail(body.smtpFrom, 'smtpFrom', errors);
    if (smtpFrom !== undefined) update.smtpFrom = smtpFrom;

    // Blank means "keep the stored password", as for the material master.
    if (body.smtpPassword !== undefined && body.smtpPassword !== '') {
      if (typeof body.smtpPassword !== 'string') errors.smtpPassword = 'Password must be text';
      else update.smtpPassword = body.smtpPassword;
    }

    const dispatchAlertEmails = validateEmailList(body.dispatchAlertEmails, 'dispatchAlertEmails', errors);
    if (dispatchAlertEmails !== undefined) update.dispatchAlertEmails = dispatchAlertEmails;

    const dispatchAlertHours = validateWholeNumber(body.dispatchAlertHours, 'dispatchAlertHours', 1, MAX_ALERT_HOURS, errors);
    if (dispatchAlertHours !== undefined) update.dispatchAlertHours = dispatchAlertHours;

    const dispatchReminderHours = validateWholeNumber(body.dispatchReminderHours, 'dispatchReminderHours', 0, MAX_ALERT_HOURS, errors);
    if (dispatchReminderHours !== undefined) update.dispatchReminderHours = dispatchReminderHours;

    if (body.dispatchAlertEnabled !== undefined) {
      if (typeof body.dispatchAlertEnabled !== 'boolean') errors.dispatchAlertEnabled = 'Must be a boolean';
      else update.dispatchAlertEnabled = body.dispatchAlertEnabled;
    }

    if (body.securityVerifyRequired !== undefined) {
      if (typeof body.securityVerifyRequired !== 'boolean') errors.securityVerifyRequired = 'Must be a boolean';
      else update.securityVerifyRequired = body.securityVerifyRequired;
    }

    const feedbackAlertEmails = validateEmailList(body.feedbackAlertEmails, 'feedbackAlertEmails', errors);
    if (feedbackAlertEmails !== undefined) update.feedbackAlertEmails = feedbackAlertEmails;

    if (body.allowRegistration !== undefined) {
      if (typeof body.allowRegistration !== 'boolean') errors.allowRegistration = 'Must be a boolean';
      else update.allowRegistration = body.allowRegistration;
    }

    if (body.parkingTwoPersonRule !== undefined) {
      if (typeof body.parkingTwoPersonRule !== 'boolean') errors.parkingTwoPersonRule = 'Must be a boolean';
      else update.parkingTwoPersonRule = body.parkingTwoPersonRule;
    }

    if (body.initialStockLoad !== undefined) {
      if (typeof body.initialStockLoad !== 'boolean') errors.initialStockLoad = 'Must be a boolean';
      else update.initialStockLoad = body.initialStockLoad;
    }

    const inTransitAlertMinutes = validateWholeNumber(body.inTransitAlertMinutes, 'inTransitAlertMinutes', 0, 1440, errors);
    if (inTransitAlertMinutes !== undefined) update.inTransitAlertMinutes = inTransitAlertMinutes;

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fieldErrors: errors });
    }

    const updated = await updateSettings(update, (req as AuthenticatedRequest).userId);

    res.json(toPublicSettings(updated));
  } catch (error) {
    console.error('Failed to update settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

/**
 * Read-only reachability probe. Never writes to the database.
 */
export const testConnectionHandler = async (req: Request, res: Response) => {
  const target = req.body?.target;

  if (target === 'email') {
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!EMAIL_RE.test(to)) return res.status(400).json({ target, ok: false, message: 'Enter a valid address to send the test to' });
    try {
      await sendMail({
        to: [to],
        subject: 'FG Yard - test e-mail',
        html: '<p>This is a test e-mail from FG Yard. E-mail alerts are working.</p>'
      });
      return res.json({ target, ok: true, message: `Test e-mail sent to ${to}` });
    } catch (error) {
      return res.json({ target, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (target !== 'production' && target !== 'material') {
    return res.status(400).json({ error: 'target must be "production", "material" or "email"' });
  }

  try {
    const result =
      target === 'production'
        ? await testProductionConnection()
        : await testMaterialMasterConnection();

    res.json({ target, ...result });
  } catch (error) {
    res.status(500).json({
      target,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Create a new key for the main gate system (or clear it with { clear: true }). The old
 * key stops working at once, so the main gate team must be given the new one.
 */
export const rotateMainGateKeyHandler = async (req: Request, res: Response) => {
  try {
    const key = req.body?.clear === true ? '' : crypto.randomBytes(24).toString('hex');
    const updated = await updateSettings({ mainGateApiKey: key }, (req as AuthenticatedRequest).userId);
    res.json(toPublicSettings(updated));
  } catch (error) {
    console.error('Failed to rotate main gate key:', error);
    res.status(500).json({ error: 'Failed to create the API key' });
  }
};

/** Whether the initial stock load and the parking two-person rule are on. Any signed-in user may read it. */
export const getStockLoadHandler = async (_req: Request, res: Response) => {
  try {
    const { initialStockLoad, parkingTwoPersonRule } = await getSettings();
    res.json({ initialStockLoad, parkingTwoPersonRule });
  } catch (error) {
    console.error('getStockLoad error:', error);
    res.status(500).json({ error: 'Failed to load the setting' });
  }
};

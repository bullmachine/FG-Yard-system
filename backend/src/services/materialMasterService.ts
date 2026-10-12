import http from 'http';
import dotenv from 'dotenv';
import prisma from '../lib/prisma';
import { getSettings } from './settingsService';
import { toNullableString } from './productionApiService';

dotenv.config();

export interface MaterialMasterRecord {
  MATERIAL: string;
  PLANT: string;
  CONF_MATERIAL: string;
}

/**
 * Outcome of the KMAT -> VehicleModelMaster auto-creation pass.
 *
 * `kmatsCreated` counts rows this run inserted; `kmatsExisting` counts KMATs already
 * present and therefore deliberately left alone. The two skip counters record values
 * deliberately rejected so a low `kmatsCreated` is explainable rather than mysterious.
 */
export interface KmatSyncSummary {
  kmatsCreated: number;
  kmatsExisting: number;
  kmatsSkippedEmpty: number;
  kmatsSkippedNotAKmat: number;
}

export interface MaterialMasterSyncResult {
  totalRecords: number;
  created: number;
  updated: number;
  errors: string[];
  kmats?: KmatSyncSummary;
}

/**
 * Placeholder type for KMAT rows the sync had to invent.
 *
 * The material API returns only MATERIAL, PLANT and CONF_MATERIAL - there is no model
 * or type upstream - but VehicleModelMaster requires all three. Rows created this way
 * are therefore incomplete by construction and need an administrator to set a real
 * `type` and a `preferredYardId`. The constant is exported so the Vehicle Model UI
 * can mark them for review instead of showing them as finished records.
 */
export const UNCLASSIFIED_KMAT_TYPE = 'UNCLASSIFIED';

/**
 * Review states a VehicleModelMaster row can hold.
 *
 * These are labels, not permissions: no code path branches on them, so flipping a row
 * to INACTIVE cannot strand a machine or change where anything is routed. They exist
 * so a human can see which KMATs the sync invented and confirm the ones they trust.
 * PENDING is what the sync assigns, and the column default, so a row is never
 * presented as reviewed without somebody having said so.
 */
export const MODEL_MASTER_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE'] as const;
export type ModelMasterStatus = (typeof MODEL_MASTER_STATUSES)[number];
export const PENDING_MODEL_STATUS: ModelMasterStatus = 'PENDING';

/**
 * Derive the display model-type from a model and a type.
 *
 * Shared with the Vehicle Model controller so an auto-created row and a hand-created
 * row can never produce two different shapes for the same inputs.
 */
export function buildModelType(model: string, type: string, custom?: string): string {
  if (custom) return custom;
  return [model, type].filter(Boolean).join('-');
}

/**
 * Decide whether a CONF_MATERIAL value can be used as a VehicleModelMaster.kmat.
 *
 * Two kinds of value are rejected:
 *  - empty/blank, which SAP returns for materials that have no config material
 *    assigned. Creating a `kmat: ""` row would be meaningless and is not unique-safe
 *    in practice.
 *  - values that are entirely digits. Those are material codes, not KMATs: in the
 *    current data they are 7-digit codes such as 8000000 and 8000036. Every genuine
 *    KMAT contains at least one letter, so this test separates the two groups cleanly
 *    without needing a hardcoded list that would go stale.
 */
export function isUsableKmat(value: string | null | undefined): value is string {
  const trimmed = toNullableString(value);
  if (trimmed === null) return false;
  if (/^[0-9]+$/.test(trimmed)) return false;
  return true;
}

/**
 * Insert a VehicleModelMaster row for every CONF_MATERIAL that does not have one yet.
 *
 * This is what makes the KMAT chain actually resolve. `syncService.resolveModelInfo`
 * joins Machine.itemCode -> MaterialMaster.material -> MaterialMaster.confMaterial ->
 * VehicleModelMaster.kmat, and until this pass runs the last step matches nothing, so
 * every machine silently falls back to a crude description parser and lands with
 * modelMasterId = null (and therefore no preferred-yard routing).
 *
 * CREATE ONLY. An existing row is never read for update, so re-running the sync cannot
 * revert a `type` or `preferredYardId` an administrator has since edited in the UI.
 * Runs as a single batched insert rather than one query per KMAT.
 */
export async function syncKmatToVehicleModelMaster(
  confMaterials: Array<string | null | undefined>
): Promise<KmatSyncSummary> {
  const summary: KmatSyncSummary = {
    kmatsCreated: 0,
    kmatsExisting: 0,
    kmatsSkippedEmpty: 0,
    kmatsSkippedNotAKmat: 0
  };

  const candidates = new Set<string>();

  for (const value of confMaterials) {
    if (toNullableString(value) === null) {
      summary.kmatsSkippedEmpty++;
      continue;
    }
    if (!isUsableKmat(value)) {
      summary.kmatsSkippedNotAKmat++;
      continue;
    }
    candidates.add(toNullableString(value) as string);
  }

  if (candidates.size === 0) {
    console.log('No usable CONF_MATERIAL values to register as KMATs');
    return summary;
  }

  const existing = await prisma.vehicleModelMaster.findMany({
    where: { kmat: { in: [...candidates] } },
    select: { kmat: true }
  });
  const existingKmats = new Set(existing.map((row) => row.kmat));

  const missing = [...candidates].filter((kmat) => !existingKmats.has(kmat));
  summary.kmatsExisting = existingKmats.size;

  if (missing.length === 0) {
    console.log(`All ${candidates.size} CONF_MATERIAL value(s) already exist as KMATs`);
    return summary;
  }

  // skipDuplicates guards the unique index in case two processes sync concurrently.
  // status is pinned to PENDING on every inserted row: the sync has no basis for
  // approving a model, so a new row always enters the review queue rather than
  // silently looking usable. An administrator promotes it to ACTIVE.
  const created = await prisma.vehicleModelMaster.createMany({
    data: missing.map((kmat) => ({
      kmat,
      model: kmat,
      type: UNCLASSIFIED_KMAT_TYPE,
      modelType: buildModelType(kmat, UNCLASSIFIED_KMAT_TYPE),
      status: PENDING_MODEL_STATUS
    })),
    skipDuplicates: true
  });

  summary.kmatsCreated = created.count;

  console.log(
    `KMAT registration: ${summary.kmatsCreated} created, ${summary.kmatsExisting} already existed ` +
    `(${summary.kmatsSkippedEmpty} empty, ${summary.kmatsSkippedNotAKmat} non-KMAT value(s) skipped)`
  );

  if (summary.kmatsCreated > 0) {
    console.log(
      `The ${summary.kmatsCreated} new KMAT row(s) use type "${UNCLASSIFIED_KMAT_TYPE}", status ` +
      `"${PENDING_MODEL_STATUS}" and have no preferred yard. Review each one in the Vehicle Model Master ` +
      'screen: set a real type, pick a preferred yard to enable yard routing, and move the status to ACTIVE.'
    );
  }

  return summary;
}

/**
 * The upstream host, credentials, plant and window size all come from the
 * admin-editable settings row, resolved at call time so a settings change takes
 * effect without a restart.
 */
async function getConfig() {
  const settings = await getSettings();
  return {
    apiUrl: settings.materialApiUrl,
    username: settings.materialUsername,
    password: settings.materialPassword,
    plant: settings.materialPlant,
    syncDays: settings.materialSyncDays,
    timeoutMs: settings.materialTimeoutMs
  };
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Sync window: the last N days inclusive of today, where N is the admin-configured
 * material sync days.
 */
export async function getDefaultDateRange(): Promise<{ fromDt: string; toDt: string }> {
  const { syncDays } = await getConfig();
  const days = Math.max(1, syncDays);
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { fromDt: formatDate(from), toDt: formatDate(to) };
}

/**
 * Fetch material master records from the SAP API (GET with JSON body + Basic auth)
 * API_TYP: FERT_API
 *
 * Uses Node core http directly: built-in fetch (undici) rejects GET requests with a body,
 * while the SAP endpoint requires the params as a raw JSON body (same as Postman).
 */
export async function fetchMaterialMaster(
  fromDt: string,
  toDt: string,
  timeoutOverrideMs?: number
): Promise<MaterialMasterRecord[]> {
  const { apiUrl, username, password, plant, timeoutMs } = await getConfig();
  const effectiveTimeoutMs = timeoutOverrideMs ?? timeoutMs;

  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const body = JSON.stringify({
    API_TYP: 'FERT_API',
    PLANT: plant,
    FROM_DT: fromDt,
    TO_DT: toDt
  });

  const parsed = new URL(apiUrl);

  const raw = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: auth
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Material master API request failed with status ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }
    );

    req.setTimeout(effectiveTimeoutMs, () => {
      req.destroy(new Error(`Material master API request timed out after ${effectiveTimeoutMs}ms`));
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid material master API response: not valid JSON (${raw.slice(0, 200)})`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Invalid material master API response: expected array, got ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data as MaterialMasterRecord[];
}

/**
 * Sync material master records from the SAP API into the MaterialMaster table
 */
export async function syncMaterialMaster(fromDt?: string, toDt?: string): Promise<MaterialMasterSyncResult> {
  const result: MaterialMasterSyncResult = {
    totalRecords: 0,
    created: 0,
    updated: 0,
    errors: []
  };

  const range = await getDefaultDateRange();
  const from = fromDt || range.fromDt;
  const to = toDt || range.toDt;

  try {
    const records = await fetchMaterialMaster(from, to);
    result.totalRecords = records.length;

    console.log(`Fetched ${records.length} material master records (${from} → ${to})`);

    for (const record of records) {
      try {
        const existing = await prisma.materialMaster.findUnique({
          where: { material: record.MATERIAL }
        });

        if (existing) {
          await prisma.materialMaster.update({
            where: { material: record.MATERIAL },
            data: {
              plant: record.PLANT,
              confMaterial: record.CONF_MATERIAL,
              syncedAt: new Date()
            }
          });
          result.updated++;
        } else {
          await prisma.materialMaster.create({
            data: {
              material: record.MATERIAL,
              plant: record.PLANT,
              confMaterial: record.CONF_MATERIAL
            }
          });
          result.created++;
        }
      } catch (error) {
        const errorMsg = `Error processing material ${record.MATERIAL}: ${error}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    console.log(`Material master sync completed: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);

    // Register every CONF_MATERIAL seen in this window as a VehicleModelMaster.kmat.
    // The set is taken from the fetched records rather than the table, so a KMAT that
    // stopped appearing in the plant window keeps its existing row and the pass stays
    // additive. A failure here must not invalidate the material rows already written,
    // so it is reported separately instead of throwing.
    try {
      result.kmats = await syncKmatToVehicleModelMaster(records.map((r) => r.CONF_MATERIAL));
    } catch (error) {
      const errorMsg = `Error registering KMATs in the vehicle model master: ${error}`;
      console.error(errorMsg);
      result.errors.push(errorMsg);
    }
    return result;
  } catch (error) {
    const errorMsg = `Error fetching material master records: ${error}`;
    console.error(errorMsg);
    result.errors.push(errorMsg);
    return result;
  }
}

/**
 * Read-only reachability probe used by the Settings page "Test" button. Runs the real
 * query for today only, with a short timeout, and writes nothing.
 */
export async function testMaterialMasterConnection(): Promise<{
  ok: boolean;
  message: string;
  recordCount: number | null;
}> {
  const { apiUrl, timeoutMs } = await getConfig();
  const today = formatDate(new Date());
  const probeTimeoutMs = 10000;
  const effectiveTimeout = Math.min(timeoutMs, probeTimeoutMs);
  const startedAt = Date.now();

  try {
    const records = await fetchMaterialMaster(today, today, effectiveTimeout);
    return {
      ok: true,
      message: `Reachable in ${Date.now() - startedAt}ms - ${records.length} record(s) for ${today}`,
      recordCount: records.length
    };
  } catch (error) {
    return {
      ok: false,
      message: `Unreachable after ${Date.now() - startedAt}ms: ${
        error instanceof Error ? error.message : String(error)
      } (${apiUrl})`,
      recordCount: null
    };
  }
}

/**
 * Get material master sync status
 */
export async function getMaterialMasterStatus() {
  const { apiUrl, plant } = await getConfig();

  const lastSync = await prisma.materialMaster.findFirst({
    orderBy: { syncedAt: 'desc' },
    select: { syncedAt: true }
  });

  const totalRecords = await prisma.materialMaster.count();

  return {
    lastSyncedAt: lastSync?.syncedAt || null,
    totalRecords,
    apiUrl,
    plant,
    dateRange: await getDefaultDateRange()
  };
}
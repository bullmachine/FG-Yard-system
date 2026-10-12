"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductionOrdersUnavailableError = void 0;
exports.toNullableString = toNullableString;
exports.formatProductionDate = formatProductionDate;
exports.getProductionDateWindow = getProductionDateWindow;
exports.getOrderTrxs = getOrderTrxs;
exports.fetchProductionOrders = fetchProductionOrders;
exports.fetchProductionOrderByNumber = fetchProductionOrderByNumber;
exports.testProductionConnection = testProductionConnection;
exports.parseOperationSeqNo = parseOperationSeqNo;
exports.parsePlantDateTime = parsePlantDateTime;
exports.isTrxCompleted = isTrxCompleted;
exports.toStageNumber = toStageNumber;
exports.getHighestCompletedStage = getHighestCompletedStage;
exports.getInProgressStage = getInProgressStage;
exports.isStageCompleted = isStageCompleted;
exports.extractModelFromDescription = extractModelFromDescription;
exports.getFertCategory = getFertCategory;
const dotenv_1 = __importDefault(require("dotenv"));
const settingsService_1 = require("./settingsService");
dotenv_1.default.config();
/**
 * Coerce a plant text field to a trimmed string, or null when it carries no value.
 *
 * Handles the three shapes the plant emits for a text column:
 *   "ABC"        -> "ABC"
 *   ["ABC"]      -> "ABC"   (single-value array wrapper)
 *   []           -> null    (empty array = no barcode, not an array)
 *   { value: ..} -> ...     (some endpoints wrap the value in an object)
 *   "" / null    -> null
 *
 * Prisma rejects an array outright, so every string column written during sync must
 * pass through here.
 */
function toNullableString(value) {
    if (value === null || value === undefined)
        return null;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const normalized = toNullableString(entry);
            if (normalized !== null)
                return normalized;
        }
        return null;
    }
    if (typeof value === 'object') {
        // Some plant endpoints wrap the payload in { value: ... } or { "#text": ... }.
        const wrapped = value;
        return toNullableString(wrapped.value ?? wrapped['#text']);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
}
/**
 * The upstream host, window size and timeout all come from the admin-editable settings
 * row, resolved at call time so a settings change takes effect without a restart.
 */
async function getConfig() {
    const settings = await (0, settingsService_1.getSettings)();
    return {
        apiBaseUrl: settings.productionApiUrl,
        timeoutMs: settings.productionTimeoutMs
    };
}
class ProductionOrdersUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProductionOrdersUnavailableError';
    }
}
exports.ProductionOrdersUnavailableError = ProductionOrdersUnavailableError;
/**
 * The production API expects YYYY-MM-DD. This is deliberately NOT the YYYYMMDD format
 * used by the material master endpoint - mixing the two silently returns "Not Available".
 */
function formatProductionDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/**
 * List of dates for the sync window, oldest first, ending today (inclusive).
 * Oldest-first ordering means the most recent day's stage wins for an order that
 * appears on several days.
 */
function getProductionDateWindow(days) {
    const count = Math.max(1, Math.floor(days));
    const dates = [];
    for (let offset = count - 1; offset >= 0; offset--) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        dates.push(formatProductionDate(date));
    }
    return dates;
}
/**
 * Read an order's operations as a real array.
 *
 * The plant returns the operation list three different ways depending on the result
 * set size: an array when there are several operations, a bare object when there is
 * exactly one, and null when there are none. Passing the bare object straight into
 * `getHighestCompletedStage` throws "trxs is not iterable" and fails the whole order,
 * so every caller must go through here instead of reading the field directly.
 */
function getOrderTrxs(order) {
    const raw = order?.production_order_trxs?.production_order_trx;
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw;
    if (typeof raw === 'object')
        return [raw];
    return [];
}
/**
 * Fetch production orders from the production API for a single date
 */
async function fetchProductionOrders(date) {
    const { apiBaseUrl, timeoutMs } = await getConfig();
    const url = `${apiBaseUrl}?hsMode=GET-PRODUCTION-ORDER-TRX&hxTrxDt=${date}`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            // The plant returns { status: "ERROR", message: "..." } when no data exists for
            // the date. That is a normal empty day, not a malformed response.
            if (data && typeof data === 'object' && data.status === 'ERROR') {
                const message = data.message || 'No data available';
                throw new ProductionOrdersUnavailableError(message);
            }
            throw new Error('Invalid API response: expected array');
        }
        return data;
    }
    catch (error) {
        if (error instanceof ProductionOrdersUnavailableError) {
            throw error;
        }
        console.error(`Error fetching production orders for ${date}:`, error);
        throw error;
    }
}
/**
 * Fetch one production order by its order number.
 *
 * The rolling date window can only ever see orders the plant published inside that
 * window, so an order that entered assembly weeks ago and is still short of stage 18
 * silently stops advancing. This re-queries that single order directly using the
 * same endpoint plus `hsOrderNo`.
 *
 * `date` is the day to search on - pass the machine's own productionDate, since that
 * is the day the plant first published the order. The response is filtered by
 * `order_no` client-side because the endpoint may echo back other orders for the day
 * rather than honouring the filter.
 *
 * Returns null when the plant has no record for that order/date pair. That is a
 * normal outcome, not an error: the caller reports it so the order can be retried
 * with a different date.
 */
async function fetchProductionOrderByNumber(date, orderNo) {
    const { apiBaseUrl, timeoutMs } = await getConfig();
    const url = `${apiBaseUrl}?hsMode=GET-PRODUCTION-ORDER-TRX&hxTrxDt=${encodeURIComponent(date)}` +
        `&hsOrderNo=${encodeURIComponent(orderNo)}`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            if (data && typeof data === 'object' && data.status === 'ERROR') {
                return null;
            }
            throw new Error('Invalid API response: expected array');
        }
        const orders = data;
        // The endpoint is documented as order-scoped, but match defensively on the
        // normalised order number so a permissive response cannot refresh the wrong machine.
        const match = orders.find((order) => toNullableString(order.order_no) === toNullableString(orderNo));
        return match ?? null;
    }
    catch (error) {
        if (error instanceof ProductionOrdersUnavailableError)
            return null;
        console.error(`Error fetching production order ${orderNo} for ${date}:`, error);
        throw error;
    }
}
/**
 * Read-only reachability probe used by the Settings page "Test" button. Queries today
 * with a short timeout and reports what came back without writing anything.
 */
async function testProductionConnection() {
    const date = formatProductionDate(new Date());
    const { apiBaseUrl } = await getConfig();
    const probeTimeoutMs = 10000;
    const startedAt = Date.now();
    try {
        const response = await fetch(`${apiBaseUrl}?hsMode=GET-PRODUCTION-ORDER-TRX&hxTrxDt=${date}`, { signal: AbortSignal.timeout(probeTimeoutMs) });
        const elapsed = Date.now() - startedAt;
        if (!response.ok) {
            return {
                ok: false,
                message: `Upstream returned HTTP ${response.status} after ${elapsed}ms`,
                orderCount: null
            };
        }
        const data = await response.json();
        if (Array.isArray(data)) {
            return {
                ok: true,
                message: `Reachable in ${elapsed}ms - ${data.length} order(s) published for ${date}`,
                orderCount: data.length
            };
        }
        if (data && typeof data === 'object' && data.status === 'ERROR') {
            const message = data.message || 'No data available';
            return {
                ok: true,
                message: `Reachable in ${elapsed}ms - upstream reports "${message}" for ${date}`,
                orderCount: 0
            };
        }
        return {
            ok: false,
            message: `Reachable in ${elapsed}ms but the response was not an order list`,
            orderCount: null
        };
    }
    catch (error) {
        return {
            ok: false,
            message: `Unreachable after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
            orderCount: null
        };
    }
}
/**
 * Parse operation_seq_no to stage number (10→1, 20→2, ..., 180→18)
 */
function parseOperationSeqNo(seqNo) {
    const num = parseInt(seqNo, 10);
    return num / 10;
}
/**
 * Parse a timestamp from the production API.
 *
 * The plant sends SQL-style local datetimes with no timezone, e.g.
 * "2026-09-03 19:24:12". Passing that straight to `new Date()` happens to work
 * on V8 but only by accident, so parse the components explicitly and treat
 * them as local time. This assumes the plant and the API server share a
 * timezone. If the plant ever moves to a different zone, pin it here rather
 * than sprinkling conversions across the codebase.
 */
function parsePlantDateTime(value) {
    const normalized = toNullableString(value);
    if (normalized === null)
        return null;
    const trimmed = normalized;
    if (!trimmed)
        return null;
    // Already ISO 8601 (or explicitly zoned) - let the runtime handle it.
    if (trimmed.includes('T') || /[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d;
    }
    // "YYYY-MM-DD HH:mm:ss" (seconds optional) in plant-local time.
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) {
        const fallback = new Date(trimmed);
        return isNaN(fallback.getTime()) ? null : fallback;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}
/**
 * A stage counts as completed once the plant has closed it off (end time
 * present) and reported a non-zero completed quantity. The plant sends "1.00"
 * for a finished operation, so any value above zero means done.
 *
 * This is deliberately a numeric check: an empty quantity would previously slip
 * through the old `!== '0.00'` comparison and mark a stage complete.
 */
function isTrxCompleted(trx) {
    if (!toNullableString(trx.end_dt_time))
        return false;
    const qty = parseFloat(toNullableString(trx.operation_completed_qty) ?? '');
    return Number.isFinite(qty) && qty > 0;
}
/**
 * Normalise one operation sequence number to its 1-based stage number.
 * "10" -> 1 ... "180" -> 18. Returns null for anything unusable so callers can
 * skip malformed rows rather than persisting a stage of 0 or NaN.
 */
function toStageNumber(seqNo) {
    if (!seqNo)
        return null;
    const stage = parseInt(seqNo, 10) / 10;
    if (!Number.isFinite(stage) || stage < 1)
        return null;
    return Math.floor(stage);
}
/**
 * Get the highest completed stage from production order transactions
 */
function getHighestCompletedStage(trxs) {
    if (!trxs || trxs.length === 0) {
        return 0;
    }
    let highestStage = 0;
    for (const trx of trxs) {
        if (isTrxCompleted(trx)) {
            const stage = toStageNumber(trx.operation_seq_no) ?? 0;
            if (stage > highestStage) {
                highestStage = stage;
            }
        }
    }
    return highestStage;
}
/**
 * The operation a machine is sitting in right now: started but not yet
 * finished. Falls back to the latest operation the plant reported, since a
 * partially filled quantity with no end time is still work in progress.
 */
function getInProgressStage(trxs) {
    if (!trxs || trxs.length === 0)
        return null;
    const open = trxs.filter((trx) => !isTrxCompleted(trx) && parsePlantDateTime(trx.start_dt_time));
    if (open.length > 0) {
        return open.reduce((max, trx) => {
            const stage = toStageNumber(trx.operation_seq_no) ?? 0;
            return stage > max ? stage : max;
        }, 0);
    }
    return null;
}
/**
 * Check if a specific stage is completed
 */
function isStageCompleted(trxs, targetStage) {
    return trxs.some((trx) => {
        if (toStageNumber(trx.operation_seq_no) !== targetStage)
            return false;
        return isTrxCompleted(trx);
    });
}
/**
 * Extract model from item description
 * Example: "SS76-BHL-4WD-FC-BS5-3SPL-IND-6IN1-0.33" → "SS76"
 */
function extractModelFromDescription(itemDsc) {
    const normalized = toNullableString(itemDsc);
    if (!normalized)
        return 'UNKNOWN';
    const parts = normalized.split('-');
    return parts[0] || 'UNKNOWN';
}
/**
 * Get FERT category from group_dsc
 * Handles both array [] and string "SKID" formats
 */
function getFertCategory(groupDsc) {
    return toNullableString(groupDsc);
}

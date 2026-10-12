"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STUCK_STAGE_LIMIT = void 0;
exports.findStuckOrders = findStuckOrders;
exports.refreshStuckOrders = refreshStuckOrders;
exports.syncProductionOrderWindow = syncProductionOrderWindow;
exports.syncProductionOrders = syncProductionOrders;
exports.syncStuckOrderByNumber = syncStuckOrderByNumber;
exports.getSyncStatus = getSyncStatus;
exports.getStageStats = getStageStats;
const prisma_1 = __importDefault(require("../lib/prisma"));
const productionApiService_1 = require("./productionApiService");
const locationAssignmentService_1 = require("./locationAssignmentService");
const notificationService_1 = require("./notificationService");
const settingsService_1 = require("./settingsService");
/**
 * An order is treated as stuck when it has been in assembly for longer than the sync
 * window and has still not reached the final stage. Such an order has already fallen
 * out of the plant's rolling feed, so it can only be refreshed by order number.
 */
exports.STUCK_STAGE_LIMIT = 18;
async function findStuckOrders(olderThanDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(0, olderThanDays));
    const candidates = await prisma_1.default.machine.findMany({
        where: {
            isDemo: false,
            assemblyStage: { lt: exports.STUCK_STAGE_LIMIT },
            productionDate: { lt: cutoff },
            orderNo: { not: null }
        },
        select: { id: true, serialNumber: true, orderNo: true, productionDate: true, assemblyStage: true },
        orderBy: { productionDate: 'asc' }
    });
    return candidates.map((machine) => ({
        ...machine,
        orderNo: machine.orderNo
    }));
}
/**
 * Re-fetch every stuck order by order number and upsert it through the same path the
 * rolling window uses.
 *
 * Runs after the window sync so an order that advanced today is already current and is
 * not re-requested. Each candidate is searched using its own productionDate, because
 * that is the day the plant first published it; asking for today would return nothing
 * for an order that entered assembly weeks ago.
 *
 * Failures are collected per order rather than aborting the run, so one unavailable
 * order cannot stop the rest from refreshing.
 */
async function refreshStuckOrders(olderThanDays) {
    const summary = { checked: 0, refreshed: 0, advanced: 0, notFound: [] };
    const candidates = await findStuckOrders(olderThanDays);
    summary.checked = candidates.length;
    if (candidates.length === 0) {
        console.log('No stuck pre-stage orders to refresh');
        return summary;
    }
    console.log(`Refreshing ${candidates.length} stuck pre-stage order(s) by order number`);
    for (const machine of candidates) {
        const searchDate = (0, productionApiService_1.formatProductionDate)(machine.productionDate);
        try {
            const order = await (0, productionApiService_1.fetchProductionOrderByNumber)(searchDate, machine.orderNo);
            if (!order) {
                summary.notFound.push(`${machine.orderNo} (${machine.serialNumber}, searched ${searchDate})`);
                continue;
            }
            await processOrder(order);
            summary.refreshed++;
            // processOrder has already written the new stage; report movement separately so
            // a caller can tell a still-stuck order from one that finally reached the limit.
            const after = await prisma_1.default.machine.findUnique({
                where: { id: machine.id },
                select: { assemblyStage: true }
            });
            if (after && after.assemblyStage >= machine.assemblyStage) {
                summary.advanced++;
            }
        }
        catch (error) {
            const errorMsg = `Error refreshing stuck order ${machine.orderNo}: ${error}`;
            console.error(errorMsg);
            summary.notFound.push(errorMsg);
        }
    }
    console.log(`Stuck order refresh: ${summary.refreshed}/${summary.checked} refreshed ` +
        `(${summary.notFound.length} not found)`);
    return summary;
}
async function getSyncWindowDays() {
    const settings = await (0, settingsService_1.getSettings)();
    return Math.max(1, settings.productionSyncDays);
}
/**
 * Sync production orders across a rolling window of recent days ending today.
 *
 * The same order is returned by the plant on several consecutive days while it is
 * still moving through assembly, so orders are deduplicated across the window before
 * processing. Otherwise a single machine would be counted and rewritten several times
 * per run.
 */
async function syncProductionOrderWindow(days) {
    const result = {
        totalOrders: 0,
        created: 0,
        updated: 0,
        errors: []
    };
    const windowDays = days ?? (await getSyncWindowDays());
    const dates = (0, productionApiService_1.getProductionDateWindow)(windowDays);
    result.window = { from: dates[0], to: dates[dates.length - 1], days: dates.length };
    result.emptyDays = [];
    const deduped = new Map();
    const emptyDays = [];
    for (const date of dates) {
        try {
            const orders = await (0, productionApiService_1.fetchProductionOrders)(date);
            if (orders.length === 0) {
                emptyDays.push(date);
                continue;
            }
            for (const order of orders) {
                // Iterating oldest -> newest, so a later day overwrites an earlier one and the
                // freshest stage data wins.
                deduped.set(`${order.order_no}|${order.item_serial_no}`, order);
            }
        }
        catch (error) {
            if (error instanceof productionApiService_1.ProductionOrdersUnavailableError) {
                console.log(`No production orders available for ${date}: ${error.message}`);
                emptyDays.push(date);
                continue;
            }
            const errorMsg = `Error fetching production orders for ${date}: ${error}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
        }
    }
    result.emptyDays = emptyDays;
    result.totalOrders = deduped.size;
    console.log(`Window ${result.window.from} -> ${result.window.to}: ${result.totalOrders} unique orders ` +
        `from ${dates.length} days (${emptyDays.length} day(s) with no data)`);
    for (const order of deduped.values()) {
        try {
            const existingMachine = await prisma_1.default.machine.findFirst({
                where: {
                    OR: [
                        { serialNumber: (0, productionApiService_1.toNullableString)(order.item_serial_no) ?? '' },
                        { orderNo: (0, productionApiService_1.toNullableString)(order.order_no) ?? '' }
                    ]
                }
            });
            const wasExisting = Boolean(existingMachine);
            await processOrder(order);
            if (wasExisting) {
                result.updated++;
            }
            else {
                result.created++;
            }
        }
        catch (error) {
            const errorMsg = `Error processing order ${(0, productionApiService_1.toNullableString)(order.order_no) ?? 'unknown'}: ${error}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
        }
    }
    console.log(`Sync completed: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);
    // The window above can only see orders published inside it. Anything still short of
    // stage 18 after the window has rolled past it has to be re-queried by order number,
    // otherwise it stays frozen at its old stage forever. Runs after the window so an
    // order that advanced today is already current and is not re-requested.
    try {
        result.stuckRefresh = await refreshStuckOrders(windowDays);
    }
    catch (error) {
        const errorMsg = `Error refreshing stuck pre-stage orders: ${error}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
    }
    return result;
}
/**
 * Sync production orders from API to database
 */
async function syncProductionOrders(date) {
    const result = {
        totalOrders: 0,
        created: 0,
        updated: 0,
        errors: []
    };
    try {
        const orders = await (0, productionApiService_1.fetchProductionOrders)(date);
        result.totalOrders = orders.length;
        console.log(`Fetched ${orders.length} production orders for date ${date}`);
        for (const order of orders) {
            try {
                // Check existence before processing. Querying afterwards would always find the
                // row processOrder just wrote and report every order as an update.
                const existingMachine = await prisma_1.default.machine.findFirst({
                    where: {
                        OR: [
                            { serialNumber: (0, productionApiService_1.toNullableString)(order.item_serial_no) ?? '' },
                            { orderNo: (0, productionApiService_1.toNullableString)(order.order_no) ?? '' }
                        ]
                    }
                });
                await processOrder(order);
                if (existingMachine) {
                    result.updated++;
                }
                else {
                    result.created++;
                }
            }
            catch (error) {
                const errorMsg = `Error processing order ${(0, productionApiService_1.toNullableString)(order.order_no) ?? 'unknown'}: ${error}`;
                console.error(errorMsg);
                result.errors.push(errorMsg);
            }
        }
        console.log(`Sync completed: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);
        return result;
    }
    catch (error) {
        const errorMsg = `Error fetching production orders: ${error}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
        return result;
    }
}
/**
 * Persist the plant's per-operation list for a machine.
 *
 * The production API returns the full operation history on every sync, so this
 * upserts each operation rather than appending blindly. Keying on
 * (machineId, operationSeqNo, source) means the daily sync refreshes rows in
 * place and can never duplicate history.
 */
async function persistStageHistory(machineId, trxs, syncedAt) {
    if (!trxs || trxs.length === 0)
        return 0;
    const rows = trxs
        .map((trx) => {
        const stage = (0, productionApiService_1.toStageNumber)(trx.operation_seq_no);
        // Skip malformed sequence numbers. The plant currently stops at 18, but
        // allow higher stages so a future operation is recorded rather than lost.
        if (stage === null || stage > 100)
            return null;
        return {
            machineId,
            stage,
            operationSeqNo: (0, productionApiService_1.toNullableString)(trx.operation_seq_no) ?? '',
            workCenter: (0, productionApiService_1.toNullableString)(trx.work_center_cd),
            startedAt: (0, productionApiService_1.parsePlantDateTime)(trx.start_dt_time),
            endedAt: (0, productionApiService_1.parsePlantDateTime)(trx.end_dt_time),
            completedQty: (0, productionApiService_1.toNullableString)(trx.operation_completed_qty),
            isCompleted: (0, productionApiService_1.isTrxCompleted)(trx),
            source: 'PLANT_SYNC',
            syncedAt
        };
    })
        .filter((row) => row !== null);
    if (rows.length === 0)
        return 0;
    await prisma_1.default.$transaction(rows.map((row) => prisma_1.default.machineStageHistory.upsert({
        where: {
            machineId_operationSeqNo_source: {
                machineId: row.machineId,
                operationSeqNo: row.operationSeqNo,
                source: row.source
            }
        },
        create: row,
        update: {
            stage: row.stage,
            workCenter: row.workCenter,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            completedQty: row.completedQty,
            isCompleted: row.isCompleted,
            syncedAt: row.syncedAt
        }
    })));
    return rows.length;
}
/**
 * Process a single production order - create or update machine
 */
async function processOrder(order) {
    // Read operations through getOrderTrxs: the plant sends a bare object rather than a
    // one-element array when an order has a single operation, which is not iterable.
    const transactions = (0, productionApiService_1.getOrderTrxs)(order);
    const highestStage = (0, productionApiService_1.getHighestCompletedStage)(transactions);
    const syncedAt = new Date();
    const modelInfo = await resolveModelInfo((0, productionApiService_1.toNullableString)(order.item_cd));
    const model = modelInfo?.modelMaster?.model || (0, productionApiService_1.extractModelFromDescription)(order.item_dsc);
    const machineType = modelInfo?.modelMaster?.type || null;
    const modelType = modelInfo?.modelMaster?.modelType || null;
    const modelMasterId = modelInfo?.modelMaster?.id || null;
    // The plant sends single-value fields as either a bare string or a one-element array,
    // and an absent value as an empty array. Prisma rejects an array outright, so every
    // text column is coerced to a trimmed string or null before it is written.
    const serialNumber = (0, productionApiService_1.toNullableString)(order.item_serial_no);
    const orderNo = (0, productionApiService_1.toNullableString)(order.order_no);
    const barcode = (0, productionApiService_1.toNullableString)(order.barcode_val);
    const itemCode = (0, productionApiService_1.toNullableString)(order.item_cd);
    const itemDescription = (0, productionApiService_1.toNullableString)(order.item_dsc);
    const productionOrderId = (0, productionApiService_1.toNullableString)(order.production_order_id);
    if (!serialNumber) {
        throw new Error('Plant order has no item_serial_no; cannot identify the machine');
    }
    // Find existing machine by serial number or order number
    const existingMachine = await prisma_1.default.machine.findFirst({
        where: {
            OR: [
                { serialNumber },
                ...(orderNo ? [{ orderNo }] : [])
            ]
        }
    });
    if (existingMachine) {
        // Update existing machine
        await prisma_1.default.machine.update({
            where: { id: existingMachine.id },
            data: {
                assemblyStage: highestStage,
                barcode,
                itemCode,
                itemDescription,
                model,
                machineType,
                modelType,
                modelMasterId,
                lastSyncAt: syncedAt
            }
        });
        // Preserve the plant's full operation list, not just the highest stage.
        await persistStageHistory(existingMachine.id, transactions, syncedAt);
        // If machine reached stage 13 and no planned slot, assign location
        if (highestStage >= 13 && !existingMachine.plannedSlotId) {
            await (0, locationAssignmentService_1.assignLocationAtStage13)(existingMachine.id);
        }
        // If machine reached stage 18, set park status to READY_TO_MOVE
        if (highestStage >= 18 && existingMachine.parkStatus === 'PLANNED') {
            await prisma_1.default.machine.update({
                where: { id: existingMachine.id },
                data: { parkStatus: 'READY_TO_MOVE' }
            });
            await (0, notificationService_1.notifyEvent)({
                type: 'READY_TO_MOVE',
                severity: 'INFO',
                title: 'Machine ready to move',
                message: `${existingMachine.serialNumber} (${existingMachine.model}) reached stage 18 and is ready for driver assignment.`,
                link: 'assembly'
            });
        }
    }
    else {
        // Create new machine. The plant sends the production date in the same
        // SQL-style local format as the operations, so parse it explicitly.
        const firstOperationStart = (0, productionApiService_1.parsePlantDateTime)(transactions[0]?.start_dt_time);
        const productionDate = firstOperationStart || syncedAt;
        const newMachine = await prisma_1.default.machine.create({
            data: {
                serialNumber,
                barcode,
                model: model,
                machineType,
                modelType,
                modelMasterId,
                productionDate: productionDate,
                status: 'AVAILABLE',
                assemblyStage: highestStage,
                orderNo,
                productionOrderId,
                itemCode,
                itemDescription,
                parkStatus: highestStage >= exports.STUCK_STAGE_LIMIT ? 'READY_TO_MOVE' : 'PLANNED',
                lastSyncAt: syncedAt
            }
        });
        await persistStageHistory(newMachine.id, transactions, syncedAt);
        // If machine is already at stage 13 or beyond, assign location
        if (highestStage >= 13 && !newMachine.plannedSlotId) {
            await (0, locationAssignmentService_1.assignLocationAtStage13)(newMachine.id);
        }
    }
}
/**
 * Upsert a single already-fetched plant order.
 *
 * Exported so maintenance scripts (reinsert-stuck-orders.ts) can rebuild a machine
 * from a per-order API response using the exact same create/update, stage-history,
 * slot-assignment and stage-18 notification logic as the daily sync. Sharing this path
 * is what stops a restored order from being shaped differently to a synced one.
 */
async function syncStuckOrderByNumber(order) {
    await processOrder(order);
}
/**
 * Resolve model info for a machine via item_cd → MaterialMaster → VehicleModelMaster
 */
async function resolveModelInfo(itemCode) {
    if (!itemCode)
        return null;
    const material = await prisma_1.default.materialMaster.findUnique({
        where: { material: itemCode }
    });
    if (!material)
        return null;
    const modelMaster = await prisma_1.default.vehicleModelMaster.findUnique({
        where: { kmat: material.confMaterial }
    });
    return { material, modelMaster };
}
/**
 * Get sync status
 */
async function getSyncStatus() {
    const lastSync = await prisma_1.default.machine.findFirst({
        orderBy: { lastSyncAt: 'desc' },
        select: { lastSyncAt: true }
    });
    const machineCount = await prisma_1.default.machine.count();
    const machinesWithStage = await prisma_1.default.machine.groupBy({
        by: ['assemblyStage'],
        _count: true
    });
    return {
        lastSyncAt: lastSync?.lastSyncAt || null,
        totalMachines: machineCount,
        machinesByStage: machinesByStage(machinesWithStage),
        // Surfaced here so the Assembly page can label the button with the real window
        // size. The settings endpoint is admin-only, so reading it from this status call
        // avoids a 403 for operators who cannot open the settings page.
        windowDays: await getSyncWindowDays()
    };
}
function machinesByStage(stageData) {
    const result = {};
    for (const item of stageData) {
        result[item.assemblyStage] = item._count;
    }
    return result;
}
/**
 * Per-stage counts for the assembly views.
 *
 * `total` is where machines currently sit, `startedToday` is how many machines
 * entered that stage today, and `inProgress` is how many are part-way through
 * that stage right now. "Today" uses local day boundaries to match the way
 * timestamps are rendered everywhere else.
 *
 * A stage can hold both a PLANT_SYNC and a MANUAL row for the same machine, so
 * every count is keyed on machine+stage to avoid counting one machine twice.
 */
async function getStageStats(includeDemo = false) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const machines = await prisma_1.default.machine.findMany({
        where: includeDemo ? {} : { isDemo: false },
        select: { id: true, assemblyStage: true }
    });
    const byStage = {};
    for (const machine of machines) {
        if (!machine.assemblyStage || machine.assemblyStage < 1)
            continue;
        if (!byStage[machine.assemblyStage]) {
            byStage[machine.assemblyStage] = { total: 0, inProgress: 0, startedToday: 0 };
        }
        byStage[machine.assemblyStage].total++;
    }
    const rows = await prisma_1.default.machineStageHistory.findMany({
        where: { machineId: { in: machines.map((m) => m.id) } },
        select: { machineId: true, stage: true, isCompleted: true, startedAt: true }
    });
    const inProgressSeen = new Set();
    const startedTodaySeen = new Set();
    for (const row of rows) {
        if (!byStage[row.stage])
            continue;
        if (!row.isCompleted) {
            const key = `${row.machineId}:${row.stage}`;
            if (!inProgressSeen.has(key)) {
                inProgressSeen.add(key);
                byStage[row.stage].inProgress++;
            }
        }
        if (row.startedAt && row.startedAt >= dayStart && row.startedAt < dayEnd) {
            const key = `${row.machineId}:${row.stage}`;
            if (!startedTodaySeen.has(key)) {
                startedTodaySeen.add(key);
                byStage[row.stage].startedToday++;
            }
        }
    }
    return {
        byStage: byStage,
        startedTodayTotal: startedTodaySeen.size,
        inProgressTotal: inProgressSeen.size,
        day: {
            from: dayStart.toISOString(),
            to: dayEnd.toISOString()
        },
        includeDemo: includeDemo,
        generatedAt: new Date().toISOString()
    };
}

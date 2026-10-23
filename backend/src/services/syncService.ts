import prisma from '../lib/prisma';
import {
  fetchProductionOrders,
  fetchProductionOrderByNumber,
  getHighestCompletedStage,
  extractModelFromDescription,
  getProductionDateWindow,
  formatProductionDate,
  ProductionOrdersUnavailableError,
  ProductionOrder,
  ProductionOrderTrx,
  parsePlantDateTime,
  isTrxCompleted,
  getOrderTrxs,
  toNullableString,
  toStageNumber
} from './productionApiService';
import { alertIfMissingBarcode, notifyEvent } from './notificationService';
import { getSettings } from './settingsService';

/**
 * Outcome of re-querying orders that are still short of stage 18 after the staleness
 * window. `notFound` lists the order numbers the plant no longer recognises for the
 * date we asked about, so they can be retried with a different date rather than
 * silently disappearing from the assembly view.
 */
export interface StuckRefreshResult {
  checked: number;
  refreshed: number;
  advanced: number;
  notFound: string[];
}

export interface SyncResult {
  totalOrders: number;
  created: number;
  updated: number;
  errors: string[];
  window?: { from: string; to: string; days: number };
  emptyDays?: string[];
  stuckRefresh?: StuckRefreshResult;
}

/**
 * An order is treated as stuck when it has been in assembly for longer than the sync
 * window and has still not reached the final stage. Such an order has already fallen
 * out of the plant's rolling feed, so it can only be refreshed by order number.
 */
export const STUCK_STAGE_LIMIT = 18;

export async function findStuckOrders(olderThanDays: number): Promise<Array<{
  id: string;
  serialNumber: string;
  orderNo: string;
  productionDate: Date;
  assemblyStage: number;
}>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Math.max(0, olderThanDays));

  const candidates = await prisma.machine.findMany({
    where: {
      isDemo: false,
      assemblyStage: { lt: STUCK_STAGE_LIMIT },
      productionDate: { lt: cutoff },
      orderNo: { not: null }
    },
    select: { id: true, serialNumber: true, orderNo: true, productionDate: true, assemblyStage: true },
    orderBy: { productionDate: 'asc' }
  });

  return candidates.map((machine) => ({
    ...machine,
    orderNo: machine.orderNo as string
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
export async function refreshStuckOrders(olderThanDays: number): Promise<StuckRefreshResult> {
  const summary: StuckRefreshResult = { checked: 0, refreshed: 0, advanced: 0, notFound: [] };

  const candidates = await findStuckOrders(olderThanDays);
  summary.checked = candidates.length;

  if (candidates.length === 0) {
    console.log('No stuck pre-stage orders to refresh');
    return summary;
  }

  console.log(`Refreshing ${candidates.length} stuck pre-stage order(s) by order number`);

  for (const machine of candidates) {
    const searchDate = formatProductionDate(machine.productionDate);

    try {
      const order = await fetchProductionOrderByNumber(searchDate, machine.orderNo);

      if (!order) {
        summary.notFound.push(`${machine.orderNo} (${machine.serialNumber}, searched ${searchDate})`);
        continue;
      }

      await processOrder(order);
      summary.refreshed++;

      // processOrder has already written the new stage; report movement separately so
      // a caller can tell a still-stuck order from one that finally reached the limit.
      const after = await prisma.machine.findUnique({
        where: { id: machine.id },
        select: { assemblyStage: true }
      });

      if (after && after.assemblyStage >= machine.assemblyStage) {
        summary.advanced++;
      }
    } catch (error) {
      const errorMsg = `Error refreshing stuck order ${machine.orderNo}: ${error}`;
      console.error(errorMsg);
      summary.notFound.push(errorMsg);
    }
  }

  console.log(
    `Stuck order refresh: ${summary.refreshed}/${summary.checked} refreshed ` +
    `(${summary.notFound.length} not found)`
  );

  return summary;
}

async function getSyncWindowDays(): Promise<number> {
  const settings = await getSettings();
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
export async function syncProductionOrderWindow(days?: number): Promise<SyncResult> {
  const result: SyncResult = {
    totalOrders: 0,
    created: 0,
    updated: 0,
    errors: []
  };

  const windowDays = days ?? (await getSyncWindowDays());
  const dates = getProductionDateWindow(windowDays);

  result.window = { from: dates[0], to: dates[dates.length - 1], days: dates.length };
  result.emptyDays = [];

  const deduped = new Map<string, ProductionOrder>();
  const emptyDays: string[] = [];

  for (const date of dates) {
    try {
      const orders = await fetchProductionOrders(date);

      if (orders.length === 0) {
        emptyDays.push(date);
        continue;
      }

      for (const order of orders) {
        // Iterating oldest -> newest, so a later day overwrites an earlier one and the
        // freshest stage data wins.
        deduped.set(`${order.order_no}|${order.item_serial_no}`, order);
      }
    } catch (error) {
      if (error instanceof ProductionOrdersUnavailableError) {
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

  console.log(
    `Window ${result.window.from} -> ${result.window.to}: ${result.totalOrders} unique orders ` +
    `from ${dates.length} days (${emptyDays.length} day(s) with no data)`
  );

  for (const order of deduped.values()) {
    try {
      const existingMachine = await prisma.machine.findFirst({
        where: {
          OR: [
            { serialNumber: toNullableString(order.item_serial_no) ?? '' },
            { orderNo: toNullableString(order.order_no) ?? '' }
          ]
        }
      });

      const wasExisting = Boolean(existingMachine);
      await processOrder(order);

      if (wasExisting) {
        result.updated++;
      } else {
        result.created++;
      }
    } catch (error) {
      const errorMsg = `Error processing order ${toNullableString(order.order_no) ?? 'unknown'}: ${error}`;
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
  } catch (error) {
    const errorMsg = `Error refreshing stuck pre-stage orders: ${error}`;
    console.error(errorMsg);
    result.errors.push(errorMsg);
  }

  return result;
}

/**
 * Sync production orders from API to database
 */
export async function syncProductionOrders(date: string): Promise<SyncResult> {
  const result: SyncResult = {
    totalOrders: 0,
    created: 0,
    updated: 0,
    errors: []
  };

  try {
    const orders = await fetchProductionOrders(date);
    result.totalOrders = orders.length;

    console.log(`Fetched ${orders.length} production orders for date ${date}`);

    for (const order of orders) {
      try {
        // Check existence before processing. Querying afterwards would always find the
        // row processOrder just wrote and report every order as an update.
        const existingMachine = await prisma.machine.findFirst({
          where: {
            OR: [
              { serialNumber: toNullableString(order.item_serial_no) ?? '' },
              { orderNo: toNullableString(order.order_no) ?? '' }
            ]
          }
        });

        await processOrder(order);

        if (existingMachine) {
          result.updated++;
        } else {
          result.created++;
        }
      } catch (error) {
        const errorMsg = `Error processing order ${toNullableString(order.order_no) ?? 'unknown'}: ${error}`;
        console.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    // Safety net: enforce "READY_TO_MOVE requires a barcode" over every machine,
    // not just the orders present in this window. Completed orders leave the
    // feed, so a barcode-less READY_TO_MOVE row could otherwise linger forever;
    // this keeps the gate list authoritative regardless of feed coverage.
    // Machines that have already left the ready phase (IN_TRANSIT or parked)
    // are never demoted.
    const barcodeLessReady = await prisma.machine.updateMany({
      where: {
        parkStatus: 'READY_TO_MOVE',
        OR: [{ barcode: null }, { barcode: '' }]
      },
      data: { parkStatus: 'PLANNED' }
    });
    if (barcodeLessReady.count > 0) {
      console.log(`Reconciliation: demoted ${barcodeLessReady.count} barcode-less READY_TO_MOVE machine(s) to PLANNED`);
    }

    console.log(`Sync completed: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);
    return result;
  } catch (error) {
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
async function persistStageHistory(
  machineId: string,
  trxs: ProductionOrderTrx[],
  syncedAt: Date
): Promise<number> {
  if (!trxs || trxs.length === 0) return 0;

  const rows = trxs
    .map((trx) => {
      const stage = toStageNumber(trx.operation_seq_no);
      // Skip malformed sequence numbers. The plant currently stops at 18, but
      // allow higher stages so a future operation is recorded rather than lost.
      if (stage === null || stage > 100) return null;

      return {
        machineId,
        stage,
        operationSeqNo: toNullableString(trx.operation_seq_no) ?? '',
        workCenter: toNullableString(trx.work_center_cd),
        startedAt: parsePlantDateTime(trx.start_dt_time),
        endedAt: parsePlantDateTime(trx.end_dt_time),
        completedQty: toNullableString(trx.operation_completed_qty),
        isCompleted: isTrxCompleted(trx),
        source: 'PLANT_SYNC' as const,
        syncedAt
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return 0;

  await prisma.$transaction(
    rows.map((row) =>
      prisma.machineStageHistory.upsert({
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
      })
    )
  );

  return rows.length;
}

/**
 * Process a single production order - create or update machine
 */
async function processOrder(order: ProductionOrder): Promise<void> {
  // Read operations through getOrderTrxs: the plant sends a bare object rather than a
  // one-element array when an order has a single operation, which is not iterable.
  const transactions = getOrderTrxs(order);
  const highestStage = getHighestCompletedStage(transactions);
  const syncedAt = new Date();
  const modelInfo = await resolveModelInfo(toNullableString(order.item_cd));
  const model = modelInfo?.modelMaster?.model || extractModelFromDescription(order.item_dsc);
  const machineType = modelInfo?.modelMaster?.type || null;
  const modelType = modelInfo?.modelMaster?.modelType || null;
  const modelMasterId = modelInfo?.modelMaster?.id || null;

  // The plant sends single-value fields as either a bare string or a one-element array,
  // and an absent value as an empty array. Prisma rejects an array outright, so every
  // text column is coerced to a trimmed string or null before it is written.
  const serialNumber = toNullableString(order.item_serial_no);
  const orderNo = toNullableString(order.order_no);
  const barcode = toNullableString(order.barcode_val);
  const itemCode = toNullableString(order.item_cd);
  const itemDescription = toNullableString(order.item_dsc);
  const productionOrderId = toNullableString(order.production_order_id);

  if (!serialNumber) {
    throw new Error('Plant order has no item_serial_no; cannot identify the machine');
  }

  // A barcode is part of gate identification, so once a machine reaches ready-to-move
  // (stage 18) it must have one. Slot assignment still proceeds ("alert but still
  // assign"), and the helper re-alerts every sync until the barcode is populated.
  // Placed before the create/update split so both paths (and stuck-order refreshes)
  // are covered.
  if (highestStage >= 18 && (!barcode || !barcode.trim())) {
    await alertIfMissingBarcode({ serialNumber, model, assemblyStage: highestStage, barcode });
  }

  // Find existing machine by serial number or order number
  const existingMachine = await prisma.machine.findFirst({
    where: {
      OR: [
        { serialNumber },
        ...(orderNo ? [{ orderNo }] : [])
      ]
    }
  });

  if (existingMachine) {
    // Update existing machine
    await prisma.machine.update({
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

    // Slots are no longer reserved at stage 13 - the machine is assigned one when a
    // driver brings it to the gate (see authenticateGate). Nothing to do here.

    // A barcode is part of gate identification: without it the machine must
    // never be offered as ready-to-move. The elevation only fires once the
    // barcode is present, and the symmetric demote below keeps the invariant
    // true even when a store-created row (or a later barcode clear) leaves an
    // existing machine in READY_TO_MOVE with an empty barcode.
    const hasBarcode = !!barcode && barcode.trim() !== '';
    if (highestStage >= 18 && existingMachine.parkStatus === 'PLANNED' && hasBarcode) {
      await prisma.machine.update({
        where: { id: existingMachine.id },
        data: { parkStatus: 'READY_TO_MOVE' }
      });

      await notifyEvent({
        type: 'READY_TO_MOVE',
        severity: 'INFO',
        title: 'Machine ready to move',
        message: `${existingMachine.serialNumber} (${existingMachine.model}) reached stage 18 and is ready for driver assignment.`,
        link: 'assembly'
      });
    } else if (existingMachine.parkStatus === 'READY_TO_MOVE' && !hasBarcode) {
      await prisma.machine.update({
        where: { id: existingMachine.id },
        data: { parkStatus: 'PLANNED' }
      });
    }
  } else {
    // Create new machine. The plant sends the production date in the same
    // SQL-style local format as the operations, so parse it explicitly.
    const firstOperationStart = parsePlantDateTime(transactions[0]?.start_dt_time);
    const productionDate = firstOperationStart || syncedAt;

    const newMachine = await prisma.machine.create({
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
        parkStatus: highestStage >= STUCK_STAGE_LIMIT && barcode && barcode.trim() !== '' ? 'READY_TO_MOVE' : 'PLANNED',
        lastSyncAt: syncedAt
      }
    });

    await persistStageHistory(newMachine.id, transactions, syncedAt);

    // No slot is reserved here: assignment happens at the gate when the machine
    // actually arrives (see authenticateGate).
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
export async function syncStuckOrderByNumber(order: ProductionOrder): Promise<void> {
  await processOrder(order);
}

/**
 * Resolve model info for a machine via item_cd → MaterialMaster → VehicleModelMaster
 */
async function resolveModelInfo(itemCode?: string | null) {
  if (!itemCode) return null;

  const material = await prisma.materialMaster.findUnique({
    where: { material: itemCode }
  });

  if (!material) return null;

  const modelMaster = await prisma.vehicleModelMaster.findUnique({
    where: { kmat: material.confMaterial }
  });

  return { material, modelMaster };
}

/**
 * Get sync status
 */
export async function getSyncStatus() {
  const lastSync = await prisma.machine.findFirst({
    orderBy: { lastSyncAt: 'desc' },
    select: { lastSyncAt: true }
  });

  const machineCount = await prisma.machine.count();
  const machinesWithStage = await prisma.machine.groupBy({
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

function machinesByStage(stageData: { assemblyStage: number; _count: number }[]) {
  const result: Record<number, number> = {};
  for (const item of stageData) {
    result[item.assemblyStage] = item._count;
  }
  return result;
}

export interface StageStat {
  total: number;
  inProgress: number;
  startedToday: number;
}

/**
 * Per-stage counts for the assembly views.
 *
 * `total` is where machines currently sit, `startedToday` is how many machine+stage
 * pairs entered that stage today, and `inProgress` is how many are part-way through
 * that stage right now. "Today" uses local day boundaries to match the way timestamps
 * are rendered everywhere else.
 *
 * A stage can hold both a PLANT_SYNC and a MANUAL row for the same machine, so every
 * count is keyed on machine+stage to avoid counting one machine twice.
 *
 * Every stage that has history gets a bucket even when no machine is sitting in it at
 * this moment. Skipping those stages used to drop them from the tallies entirely, so a
 * machine that flowed through stage 5 this morning and moved on was counted nowhere -
 * it alone made `startedTodayTotal` under-report by roughly a third. Such a stage now
 * shows total 0 with its real activity underneath.
 *
 * A pair count and a machine count are both returned because they are not
 * interchangeable: one machine runs through several stages a day, so operations always
 * run to a multiple of machines. Mixing the two up is what made "Started Today" appear
 * to equal the machine total.
 */
export async function getStageStats(includeDemo = false) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const machines = await prisma.machine.findMany({
    where: includeDemo ? {} : { isDemo: false },
    select: { id: true, assemblyStage: true }
  });

  const byStage: Record<number, StageStat> = {};

  // Lazily create the bucket so history alone can introduce a stage.
  const ensureStage = (stage: number): StageStat => {
    if (!byStage[stage]) byStage[stage] = { total: 0, inProgress: 0, startedToday: 0 };
    return byStage[stage];
  };

  for (const machine of machines) {
    if (!machine.assemblyStage || machine.assemblyStage < 1) continue;
    ensureStage(machine.assemblyStage).total++;
  }

  const rows = await prisma.machineStageHistory.findMany({
    where: { machineId: { in: machines.map((m) => m.id) } },
    select: { machineId: true, stage: true, isCompleted: true, startedAt: true }
  });

  const inProgressSeen = new Set<string>();
  const startedTodaySeen = new Set<string>();
  const inProgressMachines = new Set<string>();
  const startedTodayMachines = new Set<string>();

  for (const row of rows) {
    const stat = ensureStage(row.stage);

    if (!row.isCompleted) {
      const key = `${row.machineId}:${row.stage}`;
      if (!inProgressSeen.has(key)) {
        inProgressSeen.add(key);
        stat.inProgress++;
        inProgressMachines.add(row.machineId);
      }
    }

    if (row.startedAt && row.startedAt >= dayStart && row.startedAt < dayEnd) {
      const key = `${row.machineId}:${row.stage}`;
      if (!startedTodaySeen.has(key)) {
        startedTodaySeen.add(key);
        stat.startedToday++;
        startedTodayMachines.add(row.machineId);
      }
    }
  }

  return {
    byStage: byStage,
    // Operations: one machine contributes one entry per stage it entered today.
    startedTodayTotal: startedTodaySeen.size,
    // Machines: what a person means by "how many started today".
    machinesStartedToday: startedTodayMachines.size,
    inProgressTotal: inProgressSeen.size,
    machinesInProgress: inProgressMachines.size,
    day: {
      from: dayStart.toISOString(),
      to: dayEnd.toISOString()
    },
    includeDemo: includeDemo,
    generatedAt: new Date().toISOString()
  };
}

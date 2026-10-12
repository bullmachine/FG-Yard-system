/**
 * Snapshot the pre-stage-18 orders that the rolling sync can no longer see.
 *
 * The daily window only queries the last N days, so an order that entered assembly
 * weeks ago and has not reached stage 18 drops out of the feed and freezes at whatever
 * stage it had. `refreshStuckOrders` recovers those by re-querying each order number
 * individually.
 *
 * This script exists so that identity can be captured BEFORE a destructive cleanup.
 * `clear-assembly-data.ts` deletes every real machine, which includes the very rows
 * `refreshStuckOrders` looks for - so without a snapshot the stuck orders would be
 * lost with nothing left to re-fetch. The snapshot is the recovery key: it records
 * just enough (order number, serial, production date) for
 * `reinsert-stuck-orders.ts` to rebuild the rows from the plant afterwards.
 *
 * Read-only. Touches nothing.
 *
 * Usage:
 *   npm run sync:snapshot        write backend/stuck-orders-snapshot.json
 *   npm run sync:snapshot -- 14  widen the staleness window to 14 days
 */
import { PrismaClient } from '@prisma/client';
import { findStuckOrders, STUCK_STAGE_LIMIT } from '../src/services/syncService';
import { formatProductionDate } from '../src/services/productionApiService';
import { writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

const OUTPUT_PATH = join(process.cwd(), 'stuck-orders-snapshot.json');

function parseDaysArg(): number {
  const arg = process.argv[2];
  if (!arg) return 7;

  const parsed = Number.parseInt(arg, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`Invalid day count "${arg}". Expected a non-negative integer.`);
    process.exit(1);
  }
  return parsed;
}

async function main(): Promise<void> {
  const days = parseDaysArg();
  const stuck = await findStuckOrders(days);

  const snapshot = {
    takenAt: new Date().toISOString(),
    staleAfterDays: days,
    stageLimit: STUCK_STAGE_LIMIT,
    count: stuck.length,
    orders: stuck.map((machine) => ({
      serialNumber: machine.serialNumber,
      orderNo: machine.orderNo,
      // Stored as a plain YYYY-MM-DD because that is the format the plant expects
      // for hxTrxDt. Keeping the original Date would be ambiguous once it is
      // serialised and re-read in another timezone.
      productionDate: formatProductionDate(machine.productionDate),
      assemblyStage: machine.assemblyStage
    }))
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log(
    `Stuck-order snapshot: ${stuck.length} order(s) older than ${days} day(s) ` +
    `and still below stage ${STUCK_STAGE_LIMIT}`
  );

  for (const order of snapshot.orders) {
    console.log(
      `  ${order.orderNo}  ${order.serialNumber.padEnd(12)} stage ${String(order.assemblyStage).padStart(2)}  productionDate ${order.productionDate}`
    );
  }

  console.log(`Written to ${OUTPUT_PATH}`);

  if (stuck.length === 0) {
    console.log('Nothing to snapshot. Running clear-assembly-data.ts will not lose any stuck order.');
  }

  // Also report the full picture so an unexpected zero is obvious before a destructive run.
  const [realCount, demoCount] = await Promise.all([
    prisma.machine.count({ where: { isDemo: false } }),
    prisma.machine.count({ where: { isDemo: true } })
  ]);
  console.log(`Current machines: ${realCount} real (preserved in demo: ${demoCount})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Failed to snapshot stuck orders:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

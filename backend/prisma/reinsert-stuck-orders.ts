/**
 * Re-insert the stuck pre-stage-18 orders captured by snapshot-stuck-orders.ts.
 *
 * Run this AFTER clear-assembly-data.ts. The cleanup deletes every real machine,
 * including the ones below stage 18, which leaves `refreshStuckOrders` with no
 * candidates to work from. This script reads the snapshot and rebuilds those rows
 * straight from the plant using the per-order endpoint.
 *
 * Each order is searched using the productionDate recorded in the snapshot, because
 * that is the day the plant first published it. If the plant no longer holds data for
 * that date, the order is reported in the "not found" list and NOT recreated with
 * empty fields - a half-built machine is worse than a missing one, because it looks
 * like real data to the yard.
 *
 * The --date flag overrides the search date for every order in the snapshot. It exists
 * for the case where the plant has since rolled its history forward and the recorded
 * date is no longer queryable; try today's date to see whether the order is still
 * published under a different day.
 *
 * Usage:
 *   npm run sync:reinsert              re-fetch using each order's own productionDate
 *   npm run sync:reinsert -- --dry-run list what would be re-fetched, no writes
 *   npm run sync:reinsert -- --date 2026-09-29  override the search date
 */
import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fetchProductionOrderByNumber } from '../src/services/productionApiService';
import { syncStuckOrderByNumber } from '../src/services/syncService';

const prisma = new PrismaClient();

const SNAPSHOT_PATH = join(process.cwd(), 'stuck-orders-snapshot.json');

interface SnapshotOrder {
  serialNumber: string;
  orderNo: string;
  productionDate: string;
  assemblyStage: number;
}

interface Snapshot {
  takenAt?: string;
  staleAfterDays?: number;
  stageLimit?: number;
  count?: number;
  orders?: SnapshotOrder[];
}

function flagValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function loadSnapshot(): Snapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot found at ${SNAPSHOT_PATH}`);
    console.error('Run "npm run sync:snapshot" before clearing, or there is nothing to restore.');
    return null;
  }

  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  } catch (error) {
    console.error(`Failed to read ${SNAPSHOT_PATH}:`, error);
    return null;
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const dateOverride = flagValue('--date');

  const snapshot = loadSnapshot();
  if (!snapshot) {
    process.exit(1);
  }

  const orders = snapshot.orders ?? [];
  const searchDate = dateOverride ?? null;

  console.log('--- Re-insert stuck orders ---------------------------------------');
  console.log(`Mode:              ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Snapshot taken:    ${snapshot.takenAt ?? 'unknown'}`);
  console.log(`Orders in file:    ${orders.length}`);
  console.log(`Search date:       ${searchDate ?? "each order's own productionDate"}`);
  console.log('');

  if (orders.length === 0) {
    console.log('Snapshot contains no orders. Nothing to re-insert.');
    return;
  }

  const restored: string[] = [];
  const alreadyPresent: string[] = [];
  const notFound: string[] = [];
  const failed: string[] = [];

  for (const entry of orders) {
    const date = searchDate ?? entry.productionDate;
    const label = `${entry.orderNo} (${entry.serialNumber}, stage ${entry.assemblyStage})`;

    try {
      const order = await fetchProductionOrderByNumber(date, entry.orderNo);

      if (!order) {
        notFound.push(`${label} - plant returned nothing for ${date}`);
        console.log(`  MISSING  ${label}  (searched ${date})`);
        continue;
      }

      if (dryRun) {
        console.log(`  FOUND    ${label}  (searched ${date})`);
        continue;
      }

      // Skip if a machine with this identity already came back through the normal
      // rolling sync, so a manual re-insert can never duplicate it.
      const existing = await prisma.machine.findFirst({
        where: {
          OR: [
            { serialNumber: entry.serialNumber },
            { orderNo: entry.orderNo }
          ]
        },
        select: { id: true, assemblyStage: true }
      });

      if (existing) {
        // Still process it: the row may be the stub left by a prior partial sync and
        // running processOrder refreshes stage, history and model together.
        await syncStuckOrderByNumber(order);
        alreadyPresent.push(label);
        console.log(
          `  UPDATED  ${label}  (existing row was at stage ${existing.assemblyStage})`
        );
        continue;
      }

      await syncStuckOrderByNumber(order);
      restored.push(label);
      console.log(`  RESTORED ${label}  (searched ${date})`);
    } catch (error) {
      failed.push(`${label} - ${error}`);
      console.error(`  FAILED   ${label}: ${error}`);
    }
  }

  console.log('');
  console.log('--- Summary ------------------------------------------------------');

  if (dryRun) {
    console.log(`Would re-insert up to ${orders.length} order(s). Re-run without --dry-run to apply.`);
    return;
  }

  console.log(`Restored:          ${restored.length}`);
  console.log(`Updated existing:  ${alreadyPresent.length}`);
  console.log(`Not found:         ${notFound.length}`);
  console.log(`Failed:            ${failed.length}`);

  if (notFound.length > 0) {
    console.log('');
    console.log('The plant no longer returns these orders for the searched date. They were NOT');
    console.log('recreated, because a stub row would be indistinguishable from real data.');
    console.log('If the plant has rolled its history forward, try a different date:');
    console.log('  npm run sync:reinsert -- --date 2026-09-29');
  }

  if (failed.length > 0) {
    console.log('');
    for (const message of failed) {
      console.log(`  ${message}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Failed to re-insert stuck orders:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

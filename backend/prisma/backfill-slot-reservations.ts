/**
 * Backfills the two reservation timestamps introduced alongside the release
 * feature, for rows that predate the columns.
 *
 *   Slot.reservedAt        - when a slot was promised to a machine.
 *   Machine.slotWaitingSince - when a machine started waiting for a slot.
 *
 * Dry-run by default so it can be reviewed before it writes. Pass --execute to apply.
 *
 *   npm run slots:backfill
 *   npm run slots:backfill -- --execute
 *
 * Accuracy of the two backfills differs, deliberately:
 *
 *   RESERVED slots are backfilled from Slot.updatedAt and that value is exact.
 *   Nothing writes to a slot between the AVAILABLE -> RESERVED flip and the day it
 *   is parked, so its last update *is* the reservation.
 *
 *   Waiting machines are backfilled from Machine.createdAt and that is only a lower
 *   bound: it is when sync first saw the machine, not when it reached stage 13.
 *   It is still better than leaving them NULL, which would make the queue order
 *   arbitrary until every machine happened to be re-rejected. New rejections are
 *   stamped precisely by assignLocationAtStage13, which never overwrites a value
 *   already set, so this approximation only ever affects the pre-existing backlog.
 */
import prisma from '../src/lib/prisma';

const args = process.argv.slice(2);
const shouldExecute = args.includes('--execute');

async function main() {
  const [reservedSlots, waitingMachines, staleHeldSlots] = await Promise.all([
    // A RESERVED slot whose reservation time is unknown.
    prisma.slot.findMany({
      where: { status: 'RESERVED', reservedAt: null },
      select: { id: true, updatedAt: true },
    }),
    // A machine that has reached the point where it needs a slot but never got one.
    prisma.machine.findMany({
      where: { assemblyStage: { gte: 13 }, plannedSlotId: null, slotWaitingSince: null },
      select: { id: true, serialNumber: true, assemblyStage: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // A slot still marked RESERVED for a machine that has since parked elsewhere.
    // Only reported: repairing these is a judgement call, not a backfill.
    prisma.slot.findMany({
      where: { status: 'RESERVED', reservedAt: { not: null }, machine: null },
      select: { id: true, reservedAt: true },
    }),
  ]);

  console.log('Slot reservation backfill');
  console.log('=========================');
  console.log(`mode              : ${shouldExecute ? 'EXECUTE' : 'dry-run (pass --execute to write)'}`);
  console.log(`RESERVED slots missing reservedAt : ${reservedSlots.length}`);
  console.log(`machines waiting without a timestamp: ${waitingMachines.length}`);
  console.log(`RESERVED slots with no holder      : ${staleHeldSlots.length}`);

  if (waitingMachines.length > 0) {
    console.log('\nWaiting queue order that would result (longest wait first):');
    for (const m of waitingMachines) {
      console.log(`  ${m.createdAt.toISOString()}  stage ${m.assemblyStage}  ${m.serialNumber}`);
    }
  }

  if (reservedSlots.length > 0) {
    const oldest = reservedSlots.reduce((a, b) => (a.updatedAt < b.updatedAt ? a : b));
    const newest = reservedSlots.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    console.log(`\nRESERVED slot age range: ${oldest.updatedAt.toISOString()} .. ${newest.updatedAt.toISOString()}`);
  }

  if (staleHeldSlots.length > 0) {
    console.log('\nWARNING: these slots are RESERVED but no longer held by a machine.');
    console.log('They are eating capacity that assignLocationAtStage13 cannot see.');
    for (const s of staleHeldSlots) {
      console.log(`  slot ${s.id} reserved since ${s.reservedAt?.toISOString()}`);
    }
  }

  if (!shouldExecute) {
    console.log('\nDry run. Re-run with --execute to apply.');
    return;
  }

  // Group by timestamp so identical values collapse into one multi-row UPDATE
  // instead of 79 separate statements.
  const slotUpdates = new Map<string, string[]>();
  for (const slot of reservedSlots) {
    const key = slot.updatedAt.toISOString();
    const ids = slotUpdates.get(key) ?? [];
    ids.push(slot.id);
    slotUpdates.set(key, ids);
  }

  for (const [reservedAt, ids] of slotUpdates) {
    await prisma.slot.updateMany({
      where: { id: { in: ids } },
      data: { reservedAt: new Date(reservedAt) },
    });
  }

  let slotRowsWritten = 0;
  for (const ids of slotUpdates.values()) slotRowsWritten += ids.length;

  const machineUpdates = new Map<string, string[]>();
  for (const m of waitingMachines) {
    const key = m.createdAt.toISOString();
    const ids = machineUpdates.get(key) ?? [];
    ids.push(m.id);
    machineUpdates.set(key, ids);
  }

  for (const [since, ids] of machineUpdates) {
    await prisma.machine.updateMany({
      where: { id: { in: ids } },
      data: { slotWaitingSince: new Date(since) },
    });
  }

  let machineRowsWritten = 0;
  for (const ids of machineUpdates.values()) machineRowsWritten += ids.length;

  console.log(`\nWrote ${slotRowsWritten} slot reservedAt value(s) and ${machineRowsWritten} machine slotWaitingSince value(s).`);

  const verifySlots = await prisma.slot.count({ where: { status: 'RESERVED', reservedAt: { not: null } } });
  const verifyWaiting = await prisma.machine.count({ where: { assemblyStage: { gte: 13 }, plannedSlotId: null, slotWaitingSince: { not: null } } });
  console.log(`Verify: ${verifySlots} RESERVED slots carry reservedAt, ${verifyWaiting} waiting machines carry slotWaitingSince.`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

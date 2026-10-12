/**
 * Remove every real (non-demo) machine and its dependent rows.
 *
 * This is a destructive reset of the Assembly Line. It exists because the plant feed
 * had accumulated 64 real machines, of which many were stale duplicates that the
 * rolling window could no longer correct.
 *
 * Safety rules this script follows:
 *  - Demo rows (isDemo = true) are NEVER touched. The assembly view keeps rendering
 *    while the real data repopulates from the plant.
 *  - It defaults to a DRY RUN. Nothing is written unless --execute is passed.
 *  - Deletion happens in foreign-key-safe order inside a single transaction, so a
 *    failure part-way leaves the database untouched rather than half-deleted.
 *  - Occupied slots are released back to AVAILABLE. A machine holds a slot through
 *    Machine.currentSlotId / Machine.plannedSlotId, which have no ON DELETE CASCADE,
 *    so deleting the machine without clearing the slot status would leave the yard
 *    showing a permanently occupied slot with nothing in it.
 *
 * Only MachineStageHistory declares onDelete: Cascade. Movement, GateLog and
 * SecurityVerification do not, so those are deleted explicitly first - without this
 * ordering the machine delete fails with a foreign key constraint error.
 *
 * BEFORE running this, take a snapshot so the stuck pre-stage-18 orders can be
 * re-inserted afterwards:
 *   npm run sync:snapshot
 *
 * Usage:
 *   npm run sync:clear              dry run, prints exactly what would be deleted
 *   npm run sync:clear -- --execute actually delete
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXECUTE_FLAG = '--execute';

async function main(): Promise<void> {
  const execute = process.argv.includes(EXECUTE_FLAG);

  const realMachines = await prisma.machine.findMany({
    where: { isDemo: false },
    select: { id: true, serialNumber: true, assemblyStage: true, currentSlotId: true, plannedSlotId: true }
  });

  const ids = realMachines.map((m) => m.id);

  const [demoCount, movements, gateLogs, securityVerifications, history] = await Promise.all([
    prisma.machine.count({ where: { isDemo: true } }),
    prisma.movement.count({ where: { machineId: { in: ids } } }),
    prisma.gateLog.count({ where: { machineId: { in: ids } } }),
    prisma.securityVerification.count({ where: { machineId: { in: ids } } }),
    prisma.machineStageHistory.count({ where: { machineId: { in: ids } } })
  ]);

  const occupiedSlotIds = [
    ...new Set(
      realMachines
        .flatMap((m) => [m.currentSlotId, m.plannedSlotId])
        .filter((id): id is string => Boolean(id))
    )
  ];

  const belowStageLimit = realMachines.filter((m) => m.assemblyStage < 18);

  console.log('--- Assembly data reset -------------------------------------------');
  console.log(`Mode:              ${execute ? 'EXECUTE (destructive)' : 'DRY RUN (nothing will be written)'}`);
  console.log(`Real machines:     ${realMachines.length}`);
  console.log(`Demo machines:     ${demoCount}  (preserved)`);
  console.log(`Stage history:     ${history} rows`);
  console.log(`Movements:         ${movements}`);
  console.log(`Gate logs:         ${gateLogs}`);
  console.log(`Security verifs:   ${securityVerifications}`);
  console.log(`Slots to release:  ${occupiedSlotIds.length}`);
  console.log(`Below stage 18:    ${belowStageLimit.length}`);
  console.log('');

  if (belowStageLimit.length > 0) {
    console.log('WARNING - these orders are below stage 18 and will be DELETED.');
    console.log('The rolling window can no longer refresh them. Run "npm run sync:snapshot"');
    console.log('first, then "npm run sync:reinsert" afterwards, or they are lost.');
    for (const machine of belowStageLimit) {
      console.log(`  ${machine.serialNumber} (stage ${machine.assemblyStage})`);
    }
    console.log('');
  }

  if (realMachines.length === 0) {
    console.log('No real machines to delete. Nothing to do.');
    return;
  }

  if (!execute) {
    console.log('Dry run complete. Re-run with --execute to perform the deletion.');
    return;
  }

  const deleted = await prisma.$transaction(async (tx) => {
    // 1. Dependents without ON DELETE CASCADE, deepest first.
    const removedSecurity = await tx.securityVerification.deleteMany({
      where: { machineId: { in: ids } }
    });
    const removedGateLogs = await tx.gateLog.deleteMany({ where: { machineId: { in: ids } } });
    const removedMovements = await tx.movement.deleteMany({ where: { machineId: { in: ids } } });

    // 2. History cascades, but is deleted explicitly so the count is deterministic
    //    and the machine delete below cannot fail part-way through it.
    const removedHistory = await tx.machineStageHistory.deleteMany({
      where: { machineId: { in: ids } }
    });

    // 3. Release slots BEFORE removing the machines. Slot.status is denormalised from
    //    the machine link, so clearing it afterwards would leave the yard showing
    //    occupied slots that have no machine.
    const releasedSlots = await tx.slot.updateMany({
      where: { id: { in: occupiedSlotIds } },
      data: { status: 'AVAILABLE' }
    });

    // 4. Finally the machines themselves.
    const removedMachines = await tx.machine.deleteMany({ where: { id: { in: ids } } });

    return { removedSecurity, removedGateLogs, removedMovements, removedHistory, releasedSlots, removedMachines };
  });

  console.log('--- Deleted ------------------------------------------------------');
  console.log(`Machines:          ${deleted.removedMachines.count}`);
  console.log(`Stage history:     ${deleted.removedHistory.count} rows`);
  console.log(`Movements:         ${deleted.removedMovements.count}`);
  console.log(`Gate logs:         ${deleted.removedGateLogs.count}`);
  console.log(`Security verifs:   ${deleted.removedSecurity.count}`);
  console.log(`Slots released:    ${deleted.releasedSlots.count}`);
  console.log('');

  const [remainingReal, remainingDemo, occupiedAfter] = await Promise.all([
    prisma.machine.count({ where: { isDemo: false } }),
    prisma.machine.count({ where: { isDemo: true } }),
    prisma.slot.count({ where: { status: 'OCCUPIED' } })
  ]);

  console.log('--- After --------------------------------------------------------');
  console.log(`Real machines:     ${remainingReal}`);
  console.log(`Demo machines:     ${remainingDemo}  (preserved)`);
  console.log(`Occupied slots:    ${occupiedAfter}`);

  if (belowStageLimit.length > 0) {
    console.log('');
    console.log('Next: run "npm run sync:reinsert" to restore the snapshotted stuck orders.');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Failed to clear assembly data:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

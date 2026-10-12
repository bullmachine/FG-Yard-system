import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Enforces the invariant "READY_TO_MOVE requires a barcode". Demotes any machine
 * that is READY_TO_MOVE with an empty barcode back to PLANNED, so it is no
 * longer offered at the gate. Only the ready phase is touched: machines already
 * IN_TRANSIT or parked are never demoted (that would strand them). Runs
 * standalone via `npm run reconcile:ready-move`; the production sync enforces
 * the same rule as a safety net on every run.
 */
async function main() {
  const where = {
    parkStatus: 'READY_TO_MOVE' as const,
    OR: [{ barcode: null }, { barcode: '' }]
  };

  const barcodeLess = await prisma.machine.findMany({
    where,
    select: { serialNumber: true, assemblyStage: true }
  });

  if (barcodeLess.length === 0) {
    console.log('No barcode-less READY_TO_MOVE machines found. Nothing to do.');
    return;
  }

  const { count } = await prisma.machine.updateMany({
    where,
    data: { parkStatus: 'PLANNED' }
  });

  console.log(`Demoted ${count} barcode-less READY_TO_MOVE machine(s) to PLANNED:`);
  for (const m of barcodeLess) {
    console.log(`  - ${m.serialNumber} (stage ${m.assemblyStage})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Reconciliation failed:', e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
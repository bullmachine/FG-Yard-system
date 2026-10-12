/**
 * Trigger a material master sync from the command line and print the KMAT outcome.
 *
 * The Material Master screen already triggers this through the API, but there is no way
 * to run it from the shell. That matters here because the KMAT registration pass runs
 * inside this sync: if the material API window has rolled forward and a new CONF_MATERIAL
 * appeared, running this is how it gets registered without opening the UI.
 *
 * Usage:
 *   npm run material:sync
 *   npm run material:sync -- 2026-09-01 2026-09-29
 */
import prisma from '../src/lib/prisma';
import { syncMaterialMaster } from '../src/services/materialMasterService';

async function main(): Promise<void> {
  const [fromDt, toDt] = process.argv.slice(2);
  const result = await syncMaterialMaster(fromDt, toDt);

  console.log('');
  console.log('--- Material sync result -----------------------------------------');
  console.log(`Records:  ${result.totalRecords}`);
  console.log(`Created:  ${result.created}`);
  console.log(`Updated:  ${result.updated}`);
  console.log(`Errors:   ${result.errors.length}`);
  for (const error of result.errors.slice(0, 10)) {
    console.log(`  ${error}`);
  }
  if (result.kmats) {
    console.log('');
    console.log('--- KMAT registration -------------------------------------------');
    console.log(`Created:  ${result.kmats.kmatsCreated}`);
    console.log(`Existing: ${result.kmats.kmatsExisting}`);
    console.log(`Skipped:  ${result.kmats.kmatsSkippedEmpty} empty, ${result.kmats.kmatsSkippedNotAKmat} material code(s)`);
    if (result.kmats.kmatsCreated > 0) {
      console.log('');
      console.log('New rows use type UNCLASSIFIED and have no preferred yard. Set both in');
      console.log('Vehicle Model Master, then run: npm run kmat:backfill -- --execute');
    }
  }

  const total = await prisma.vehicleModelMaster.count();
  const pending = await prisma.vehicleModelMaster.count({ where: { type: 'UNCLASSIFIED' } });
  console.log('');
  console.log(`Vehicle model masters: ${total} total, ${pending} still UNCLASSIFIED`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Material sync failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

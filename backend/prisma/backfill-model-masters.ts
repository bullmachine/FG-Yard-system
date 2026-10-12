/**
 * Re-resolve the KMAT -> VehicleModelMaster link for machines that already exist.
 *
 * The production sync only refreshes machines it re-reads from the plant, so once the
 * material sync has registered the missing KMAT rows, every machine already in the
 * database still carries modelMasterId = null and a crude description-derived model
 * name until the plant happens to publish that order again inside the sync window.
 * That can be never, for an order that is long finished.
 *
 * This script closes that gap directly from the database, without calling the plant.
 * That matters because the plant at 192.168.1.103 is frequently unreachable, and a
 * backfill that depended on it would be unrunnable exactly when it is needed.
 *
 * The join mirrors syncService.resolveModelInfo exactly:
 *   Machine.itemCode -> MaterialMaster.material -> MaterialMaster.confMaterial
 *                    -> VehicleModelMaster.kmat
 *
 * Machines with no matching MaterialMaster row, or whose CONF_MATERIAL is empty or is
 * an all-digit material code, are reported as unresolved rather than assigned a
 * fabricated KMAT. Demo machines are skipped by default.
 *
 * Usage:
 *   npm run kmat:backfill              dry run, prints what would change
 *   npm run kmat:backfill -- --execute actually write
 *   npm run kmat:backfill -- --include-demo   also process demo machines
 *   npm run kmat:backfill -- --execute --all  re-resolve every machine, not just
 *                                         the ones with a null modelMasterId
 */
import { PrismaClient } from '@prisma/client';
import { extractModelFromDescription, toNullableString } from '../src/services/productionApiService';
import { isUsableKmat } from '../src/services/materialMasterService';

const prisma = new PrismaClient();

const EXECUTE_FLAG = '--execute';
const ALL_FLAG = '--all';
const INCLUDE_DEMO_FLAG = '--include-demo';

interface Plan {
  machineId: string;
  serialNumber: string;
  fromModel: string;
  toModel: string;
  kmat: string;
  modelType: string | null;
  machineType: string | null;
}

interface Unresolved {
  serialNumber: string;
  itemCode: string | null;
  reason: string;
}

async function main(): Promise<void> {
  const execute = process.argv.includes(EXECUTE_FLAG);
  const all = process.argv.includes(ALL_FLAG);
  const includeDemo = process.argv.includes(INCLUDE_DEMO_FLAG);

  const machines = await prisma.machine.findMany({
    where: all ? (includeDemo ? {} : { isDemo: false }) : { isDemo: includeDemo ? undefined : false, modelMasterId: null },
    select: {
      id: true,
      serialNumber: true,
      itemCode: true,
      itemDescription: true,
      model: true,
      machineType: true,
      modelType: true,
      modelMasterId: true
    }
  });

  console.log('--- Model master backfill ------------------------------------------');
  console.log(`Mode:             ${execute ? 'EXECUTE' : 'DRY RUN (nothing will be written)'}`);
  console.log(`Scope:            ${all ? 'every machine' : 'machines with no model master'}`);
  console.log(`Demo machines:    ${includeDemo ? 'included' : 'skipped'}`);
  console.log(`Machines scanned: ${machines.length}`);
  console.log('');

  if (machines.length === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  // Load the lookup tables once rather than per machine.
  const materials = await prisma.materialMaster.findMany({
    select: { material: true, confMaterial: true }
  });
  const materialByCode = new Map(materials.map((m) => [m.material, toNullableString(m.confMaterial)]));

  const kmats = await prisma.vehicleModelMaster.findMany({
    select: { id: true, kmat: true, model: true, type: true, modelType: true }
  });
  const kmatByValue = new Map(kmats.map((k) => [k.kmat, k]));

  const plan: Plan[] = [];
  const unresolved: Unresolved[] = [];

  for (const machine of machines) {
    const confMaterial = machine.itemCode ? materialByCode.get(machine.itemCode) : undefined;

    if (!machine.itemCode) {
      unresolved.push({ serialNumber: machine.serialNumber, itemCode: null, reason: 'machine has no item code' });
      continue;
    }
    if (confMaterial === undefined) {
      unresolved.push({ serialNumber: machine.serialNumber, itemCode: machine.itemCode, reason: 'item code not in material master' });
      continue;
    }
    if (confMaterial === null) {
      unresolved.push({ serialNumber: machine.serialNumber, itemCode: machine.itemCode, reason: 'material has an empty CONF_MATERIAL' });
      continue;
    }
    if (!isUsableKmat(confMaterial)) {
      unresolved.push({ serialNumber: machine.serialNumber, itemCode: machine.itemCode, reason: `CONF_MATERIAL "${confMaterial}" is a material code, not a KMAT` });
      continue;
    }

    const kmat = kmatByValue.get(confMaterial);
    if (!kmat) {
      unresolved.push({ serialNumber: machine.serialNumber, itemCode: machine.itemCode, reason: `no vehicle model master row for KMAT "${confMaterial}"` });
      continue;
    }

    const toModel = kmat.model || extractModelFromDescription(machine.itemDescription);
    const nextModelType = kmat.modelType || toModel;
    const nextMachineType = kmat.type;

    // Only record a change when something actually differs, so the report shows real
    // work rather than every scanned machine.
    if (
      machine.modelMasterId === kmat.id &&
      machine.model === toModel &&
      machine.machineType === nextMachineType &&
      machine.modelType === nextModelType
    ) {
      continue;
    }

    plan.push({
      machineId: machine.id,
      serialNumber: machine.serialNumber,
      fromModel: machine.model,
      toModel,
      kmat: kmat.kmat,
      modelType: nextModelType,
      machineType: nextMachineType
    });
  }

  console.log(`Resolvable:       ${plan.length}`);
  console.log(`Unresolved:       ${unresolved.length}`);
  console.log('');

  if (plan.length > 0) {
    console.log('--- Changes ------------------------------------------------------');
    // Group by the KMAT so the output stays readable with hundreds of machines.
    const byKmat = new Map<string, Plan[]>();
    for (const item of plan) {
      if (!byKmat.has(item.kmat)) byKmat.set(item.kmat, []);
      byKmat.get(item.kmat)!.push(item);
    }
    for (const [kmat, items] of byKmat) {
      console.log(`  ${kmat} (${items.length} machine(s))`);
      for (const item of items.slice(0, 3)) {
        console.log(`    ${item.serialNumber.padEnd(12)} "${item.fromModel}" -> "${item.toModel}"`);
      }
      if (items.length > 3) {
        console.log(`    ... and ${items.length - 3} more`);
      }
    }
    console.log('');
  }

  if (unresolved.length > 0) {
    console.log('--- Unresolved (need a material mapping, not a code fix) ----------');
    const byReason = new Map<string, Unresolved[]>();
    for (const item of unresolved) {
      if (!byReason.has(item.reason)) byReason.set(item.reason, []);
      byReason.get(item.reason)!.push(item);
    }
    for (const [reason, items] of byReason) {
      console.log(`  ${reason}: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        console.log(`    ${item.serialNumber} (item ${item.itemCode})`);
      }
      if (items.length > 5) {
        console.log(`    ... and ${items.length - 5} more`);
      }
    }
    console.log('');
  }

  if (!execute) {
    console.log('Dry run complete. Re-run with --execute to apply.');
    return;
  }

  // Each machine is written in its own statement so one failure cannot roll back the
  // whole batch; failures are collected and reported at the end.
  let updated = 0;
  const failures: string[] = [];

  for (const item of plan) {
    try {
      await prisma.machine.update({
        where: { id: item.machineId },
        data: {
          model: item.toModel,
          machineType: item.machineType,
          modelType: item.modelType,
          modelMasterId: kmatByValue.get(item.kmat)!.id
        }
      });
      updated++;
    } catch (error) {
      failures.push(`${item.serialNumber}: ${error}`);
    }
  }

  console.log('--- Applied ------------------------------------------------------');
  console.log(`Machines updated: ${updated}`);
  console.log(`Failures:         ${failures.length}`);

  for (const failure of failures) {
    console.log(`  ${failure}`);
  }

  const stillNull = await prisma.machine.count({
    where: { isDemo: includeDemo ? undefined : false, modelMasterId: null }
  });
  console.log('');
  console.log(`Machines still without a model master: ${stillNull}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Failed to backfill model masters:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

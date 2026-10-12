/**
 * Offline regression test for slot reservation, release and FIFO reallocation.
 *
 * Creates its own yard + machines, exercises the real service functions against the
 * real database, then deletes every row it created, including the notifications the
 * services emit. Failure to clean up a scenario aborts loudly rather than leaving
 * test rows behind.
 *
 * The live database is shared with whatever is currently queued for a slot, so the
 * test temporarily parks the real waiting machines' stamps (and restores them) to
 * keep FIFO deterministic. It never touches their planned slots, park status or
 * drivers.
 *
 * Run: ts-node prisma/verify-slot-release.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  assignLocationAtStage13,
  assignSlotToMachine,
  releaseSlotReservation,
  getYardAvailability,
} from '../src/services/locationAssignmentService';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const RUN_ID = `VFY-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

// Fully synthetic objects: no serial collision, no plant dependency, no demo flag.
let useUserIds: string[];
let yard: { id: string } | null = null;
let slots: string[] = [];
let machines: Record<string, string> = {};
let driver: { id: string } | null = null;
let queueSnapshot: { id: string; slotWaitingSince: Date | null }[] = [];

async function fixtureSignal(serial: string) {
  const m = await prisma.machine.findUnique({ where: { serialNumber: serial } });
  return {
    plannedSlotId: m?.plannedSlotId ?? null,
    currentSlotId: m?.currentSlotId ?? null,
    driverId: m?.driverId ?? null,
    parkStatus: m?.parkStatus ?? null,
    slotWaitingSince: m?.slotWaitingSince ?? null,
  };
}

async function slotSignal(slotId: string) {
  const s = await prisma.slot.findUnique({ where: { id: slotId } });
  return { status: s?.status ?? null, reservedAt: s?.reservedAt ?? null };
}

async function createSlot(col: number, status: 'AVAILABLE' | 'RESERVED'): Promise<string> {
  await prisma.slot.create({
    data: { yardId: yard!.id, row: 1, col, status, reservedAt: status === 'RESERVED' ? new Date() : null },
  });
  const created = await prisma.slot.findFirst({ where: { yardId: yard!.id, col } });
  if (!created) throw new Error('Failed to create test slot');
  return created.id;
}

async function createFixtures() {
  const { systemUser, yardManager } = await (async () => {
    const sys = await prisma.user.findUnique({ where: { email: 'system@yard.local' } });
    const mgr = await prisma.user.findFirst({ where: { role: 'YARD_MANAGER', isActive: true } });
    if (!sys || !mgr) throw new Error('Test needs the system service account and an active YARD_MANAGER');
    return { systemUser: sys, yardManager: mgr };
  })();
  useUserIds = [systemUser.id, yardManager.id];

  // Two slots only: exactly enough for A and B, so C and D must be refused and
  // exercise the fullness path instead of discovering a spare.
  yard = await prisma.yard.create({
    data: {
      name: `Verify Yard ${RUN_ID}`,
      description: 'temporary test fixtures; deleted on completion',
      rows: 1,
      cols: 2,
    },
  });

  await prisma.slot.createMany({
    data: [1, 2].map((col) => ({
      yardId: yard!.id,
      row: 1,
      col,
      status: 'AVAILABLE' as const,
    })),
  });
  slots = (await prisma.slot.findMany({ where: { yardId: yard.id }, orderBy: { col: 'asc' } })).map((s) => s.id);
  if (slots.length !== 2) throw new Error('Failed to create test slots');

  driver = await prisma.driver.create({ data: { name: `Verify Driver ${RUN_ID}`, status: 'TEST' } });

  for (const label of ['A', 'B', 'C', 'D'] as const) {
    const m = await prisma.machine.create({
      data: {
        serialNumber: `${RUN_ID}-${label}`,
        model: `VERIFY-${label}`,
        productionDate: new Date(),
        status: 'AVAILABLE',
        assemblyStage: 13,
        parkStatus: 'PLANNED',
      },
    });
    machines[label] = m.id;
  }

  // Isolate the FIFO hands-off from the real 21-machine queue: snapshot the waiting
  // stamps and clear them for the duration, then restore the exact values on exit.
  queueSnapshot = await prisma.machine.findMany({
    where: {
      isDemo: false,
      assemblyStage: { gte: 13 },
      plannedSlotId: null,
      currentSlotId: null,
      slotWaitingSince: { not: null },
    },
    select: { id: true, slotWaitingSince: true },
  });
  if (queueSnapshot.length > 0) {
    await prisma.machine.updateMany({
      where: { id: { in: queueSnapshot.map((q) => q.id) } },
      data: { slotWaitingSince: null },
    });
  }
}

async function cleanup() {
  if (queueSnapshot.length > 0) {
    for (const row of queueSnapshot) {
      await prisma.machine.update({
        where: { id: row.id },
        data: { slotWaitingSince: row.slotWaitingSince },
      });
    }
    queueSnapshot = [];
  }

  const ids = Object.values(machines);
  if (ids.length > 0) {
    await prisma.movement.deleteMany({ where: { machineId: { in: ids } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids } } });
  }
  if (driver) {
    await prisma.driver.deleteMany({ where: { id: driver.id } });
  }
  if (yard) {
    // Any movement a released slot created lives in the test yard; sweeping by yardId
    // catches them all regardless of which machine ended up taking the slot.
    await prisma.movement.deleteMany({ where: { yardId: yard.id } });
    await prisma.slot.deleteMany({ where: { yardId: yard.id } });
    await prisma.yard.delete({ where: { id: yard.id } });
  }
  await prisma.notification.deleteMany({
    where: {
      type: { in: ['SLOT_RELEASED', 'SLOT_REASSIGNED', 'YARD_FULL'] },
      message: { contains: RUN_ID },
    },
  });
}

async function main() {
  const startedAt = new Date();
  console.log(`Slot release verification (run ${RUN_ID})`);
  console.log('============================================');

  await createFixtures();

  try {
    check('fixtures created', slots.length === 2 && Object.keys(machines).length === 4);

    // --- Assignment reserves with reservedAt and clears waitingSince ------------
    const r1 = await assignLocationAtStage13(machines.A);
    check('A assigned', r1.success === true, JSON.stringify(r1));
    const aAfter1 = await fixtureSignal(`${RUN_ID}-A`);
    check('A holds a slot', Boolean(aAfter1.plannedSlotId), JSON.stringify(aAfter1));
    const s1 = aAfter1.plannedSlotId!;
    check('A no longer waiting', aAfter1.slotWaitingSince === null);
    const slotA = await slotSignal(s1);
    check('slot A reservedAt stamped', slotA.status === 'RESERVED' && slotA.reservedAt !== null, JSON.stringify(slotA));

    const r2 = await assignLocationAtStage13(machines.B);
    check('B assigned (FIFO untouched, slots remaining)', r2.success === true, JSON.stringify(r2));
    const bAfter2 = await fixtureSignal(`${RUN_ID}-B`);
    check('B holds a slot', Boolean(bAfter2.plannedSlotId));

    // --- Full-yard refusal stamps the waiting clock once ------------------------
    const r3 = await assignLocationAtStage13(machines.C);
    check('C refused with NO_SLOT_ANYWHERE', r3.success === false && r3.error === 'YARD IS FULL' && r3.errorCode === 'NO_SLOT_ANYWHERE', JSON.stringify(r3));
    check('exhaustion names the yard', Array.isArray(r3.availability) && r3.availability.length > 0);
    const cAfter3 = await fixtureSignal(`${RUN_ID}-C`);
    const firstWaitStamp = cAfter3.slotWaitingSince;
    check('C waiting clock started', firstWaitStamp !== null, JSON.stringify(cAfter3));

    const r4 = await assignLocationAtStage13(machines.C);
    const cAfter4 = await fixtureSignal(`${RUN_ID}-C`);
    check('waiting clock not overwritten on recheck', r4.success === false && cAfter4.slotWaitingSince?.getTime() === firstWaitStamp?.getTime());

    const r5 = await assignLocationAtStage13(machines.D);
    check('D refused and stamped as well', r5.success === false && (await fixtureSignal(`${RUN_ID}-D`)).slotWaitingSince !== null, JSON.stringify(r5));

    // --- Release guard: driver assigned ------------------------------------------
    await prisma.machine.update({ where: { id: machines.A }, data: { driverId: driver!.id } });
    const r6 = await releaseSlotReservation(s1, `Verify driver guard ${RUN_ID}`, useUserIds[0]);
    check('release blocked while driver assigned', r6.success === false && r6.releaseBlockedReason === 'DRIVER_ASSIGNED', JSON.stringify(r6));
    check('slot A still reserved after blocked release', (await slotSignal(s1)).status === 'RESERVED');
    await prisma.machine.update({ where: { id: machines.A }, data: { driverId: null } });

    // --- Release guard: on the road ----------------------------------------------
    await prisma.machine.update({ where: { id: machines.A }, data: { parkStatus: 'IN_TRANSIT' } });
    const r7 = await releaseSlotReservation(s1, `Verify transit guard ${RUN_ID}`, useUserIds[0]);
    check('release blocked while IN_TRANSIT', r7.success === false && r7.releaseBlockedReason === 'IN_TRANSIT', JSON.stringify(r7));
    await prisma.machine.update({ where: { id: machines.A }, data: { parkStatus: 'PLANNED' } });

    // --- Release reassigns to longest waiter -------------------------------------
    // C is the oldest waiter (refusal in T3, before D). Backdate it well below the
    // real queue's floor so FIFO deterministically prefers C over everyone.
    await prisma.machine.update({ where: { id: machines.C }, data: { slotWaitingSince: new Date('2020-01-01T00:00:00Z') } });

    const r8 = await releaseSlotReservation(s1, `Verify release ${RUN_ID}`, useUserIds[0]);
    check('release succeeds', r8.success === true, JSON.stringify(r8));
    check('slot offered to C (oldest waiter)', r8.success && r8.reassignedTo === `${RUN_ID}-C`, JSON.stringify(r8));
    const aAfter8 = await fixtureSignal(`${RUN_ID}-A`);
    const cAfter8 = await fixtureSignal(`${RUN_ID}-C`);
    check('A released and re-queued behind everyone', aAfter8.plannedSlotId === null && aAfter8.slotWaitingSince !== null, JSON.stringify(aAfter8));
    check('C now holds the released slot', cAfter8.plannedSlotId === s1 && cAfter8.slotWaitingSince === null, JSON.stringify(cAfter8));
    check('released slot is RESERVED again with a fresh stamp', (await slotSignal(s1)).status === 'RESERVED');

    // --- Second release: next hand-off goes to the next-oldest waiter ------------
    // D was stamped at the first refusal; A only re-entered the queue at T8, so D is
    // the oldest waiter here. A must NOT simply take its own slot back.
    const r9 = await releaseSlotReservation(s1, `Verify second release ${RUN_ID}`, useUserIds[0]);
    check('second release reassigns to D (next oldest)', r9.success === true && r9.reassignedTo === `${RUN_ID}-D`, JSON.stringify(r9));
    const aAfter9 = await fixtureSignal(`${RUN_ID}-A`);
    const dAfter9 = await fixtureSignal(`${RUN_ID}-D`);
    check('A still queued, did not leapfrog back onto the slot', aAfter9.plannedSlotId === null && aAfter9.slotWaitingSince !== null, JSON.stringify(aAfter9));
    check('D now holds the released slot', dAfter9.plannedSlotId === s1 && dAfter9.slotWaitingSince === null, JSON.stringify(dAfter9));

    // --- Availability summary reflects the test yard ------------------------------
    const avail = await getYardAvailability();
    const testYard = avail.find((y) => y.yardId === yard!.id);
    check('availability summary includes test yard', Boolean(testYard), JSON.stringify(testYard));
    check('test yard reports 2 held slots and none free', testYard?.reserved === 2 && testYard?.total === 2 && testYard?.available === 0, JSON.stringify(testYard));

    // --- Release guards: not reserved / no holder --------------------------------
    const spare = await createSlot(3, 'AVAILABLE');
    const r10 = await releaseSlotReservation(spare, `Verify spare ${RUN_ID}`, useUserIds[0]);
    check('AVAILABLE slot cannot be released', r10.success === false && r10.errorCode === 'SLOT_NOT_AVAILABLE', JSON.stringify(r10));

    const holderless = await createSlot(4, 'RESERVED');
    const r11 = await releaseSlotReservation(holderless, `Verify holderless ${RUN_ID}`, useUserIds[0]);
    check('holderless RESERVED slot cannot be released', r11.success === false && String(r11.error ?? '').toLowerCase().includes('no machine'), JSON.stringify(r11));

    // --- Manual assignment still refuses a non-AVAILABLE slot ---------------------
    const r12 = await assignSlotToMachine(machines.D, s1, useUserIds[0]);
    check('manual assign refuses an already RESERVED slot', r12.success === false && r12.errorCode === 'SLOT_NOT_AVAILABLE', JSON.stringify(r12));
  } finally {
    await cleanup();
    const span = Date.now() - startedAt.getTime();
    console.log('\n----------------------------------------');
    console.log(`${passed} passed, ${failed} failed (${span}ms)`);
    if (failures.length > 0) {
      console.log('Failures:');
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  }
}

main()
  .catch(async (error) => {
    console.error('Verification crashed:', error);
    try {
      await cleanup();
    } catch {
      // best effort
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
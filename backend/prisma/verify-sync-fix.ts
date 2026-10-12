/**
 * Offline regression test for the empty-barcode sync failure and the stuck-order
 * refresh. Stubs global fetch so it runs without the plant LAN being reachable.
 *
 * Run: ts-node prisma/verify-sync-fix.ts
 */
import { PrismaClient } from '@prisma/client';
import { toNullableString, parsePlantDateTime, isTrxCompleted, toStageNumber, getOrderTrxs, getHighestCompletedStage } from '../src/services/productionApiService';
import { findStuckOrders, refreshStuckOrders, syncProductionOrderWindow } from '../src/services/syncService';

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

const TEST_SERIAL = 'TEST-BC-0001';
const TEST_ORDER = '000099999001';
const TEST_DATE = '2026-05-14';

/** A trx array covering stages 1..3, with stage 3 left open. */
function buildTrxs() {
  const rows = [];
  for (let stage = 1; stage <= 3; stage++) {
    rows.push({
      operation_seq_no: String(stage * 10),
      start_dt_time: `2026-05-${String(10 + stage).padStart(2, '0')} 08:00:00`,
      end_dt_time: stage < 3 ? `2026-05-${String(10 + stage).padStart(2, '0')} 12:00:00` : '',
      work_center_cd: ['WC1', 'WC2', 'WC3'][stage - 1],
      operation_completed_qty: stage < 3 ? '1.00' : ''
    });
  }
  return { production_order_trx: rows };
}

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    order_no: TEST_ORDER,
    item_serial_no: TEST_SERIAL,
    item_cd: 'TESTITEM001',
    item_dsc: 'SS99-TEST-BENCH',
    plan_operation_group_cd: 'GRP',
    barcode_val: [],
    production_order_id: 'POTEST1',
    group_dsc: 'SKID',
    production_order_trxs: buildTrxs(),
    ...overrides
  };
}

async function cleanupTestRows(): Promise<void> {
  const machines = await prisma.machine.findMany({
    where: { serialNumber: { startsWith: 'TEST-BC-' } },
    select: { id: true }
  });
  const ids = machines.map((m) => m.id);
  if (ids.length === 0) return;

  await prisma.movement.deleteMany({ where: { machineId: { in: ids } } });
  await prisma.gateLog.deleteMany({ where: { machineId: { in: ids } } });
  await prisma.securityVerification.deleteMany({ where: { machineId: { in: ids } } });
  await prisma.machineStageHistory.deleteMany({ where: { machineId: { in: ids } } });
  await prisma.machine.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  console.log('--- Unit: toNullableString ----------------------------------------');
  check('empty array -> null', toNullableString([]) === null);
  check('single-element array unwraps', toNullableString(['HP43C00940']) === 'HP43C00940');
  check('array of empties -> null', toNullableString(['', '  ']) === null);
  check('plain string trims', toNullableString('  ABC  ') === 'ABC');
  check('empty string -> null', toNullableString('') === null);
  check('null -> null', toNullableString(null) === null);
  check('undefined -> null', toNullableString(undefined) === null);
  check('object wrapper unwraps', toNullableString({ value: 'XYZ' }) === 'XYZ');
  check('number coerces', toNullableString(0) === '0');

  console.log('--- Unit: getOrderTrxs normalises the plant result-set shapes ------');
  check('array stays array', getOrderTrxs({ production_order_trxs: { production_order_trx: [] } } as any).length === 0);
  check(
    'single-operation object is wrapped into an array',
    getOrderTrxs({ production_order_trxs: { production_order_trx: { operation_seq_no: '10' } as any } } as any).length === 1
  );
  check('null trxs -> empty array', getOrderTrxs({ production_order_trxs: null } as any).length === 0);
  check('missing trxs -> empty array', getOrderTrxs({} as any).length === 0);
  check('undefined order -> empty array', getOrderTrxs(undefined).length === 0);
  check(
    'single-op order yields its stage',
    getHighestCompletedStage(getOrderTrxs({
      production_order_trxs: {
        production_order_trx: {
          operation_seq_no: '10',
          start_dt_time: '2026-05-11 08:00:00',
          end_dt_time: '2026-05-11 12:00:00',
          work_center_cd: 'WC1',
          operation_completed_qty: '1.00'
        } as any
      }
    } as any)) === 1
  );

  console.log('--- Unit: trx helpers tolerate array shape ------------------------');
  const trx = buildTrxs().production_order_trx[0];
  check('parsePlantDateTime handles array', parsePlantDateTime(['2026-05-11 08:00:00'] as any) !== null);
  check('isTrxCompleted with array qty', isTrxCompleted({ ...trx, operation_completed_qty: ['1.00'] as any }) === true);
  check('isTrxCompleted with empty array', isTrxCompleted({ ...trx, operation_completed_qty: [] as any }) === false);
  check('toStageNumber 180 -> 18', toStageNumber('180') === 18);

  console.log('--- Integration: empty barcode order upserts -----------------------');
  await cleanupTestRows();

  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('hsOrderNo=')) {
      return {
        ok: true,
        status: 200,
        json: async () => [orderPayload()]
      } as any;
    }
    // The window path also has to return the order, otherwise nothing is ever created
    // and the create-path assertions below cannot run.
    return { ok: true, status: 200, json: async () => [orderPayload()] } as any;
  }) as any;

  try {
    const result = await syncProductionOrderWindow(1);
    check('window sync reported no errors', result.errors.length === 0, result.errors.join(' | '));

    const created = await prisma.machine.findUnique({
      where: { serialNumber: TEST_SERIAL },
      select: { barcode: true, assemblyStage: true, orderNo: true, isDemo: true }
    });
    check('machine was created', created !== null);
    check('barcode stored as null not []', created?.barcode === null, `got ${JSON.stringify(created?.barcode)}`);
    check('order number persisted', created?.orderNo === TEST_ORDER);
    check('stage 2 (last completed) persisted', created?.assemblyStage === 2, `got ${created?.assemblyStage}`);
    check('test row is not demo', created?.isDemo === false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('--- Integration: stuck order re-fetch by number -------------------');
  await cleanupTestRows();

  // Seed a machine that looks stuck: below stage 18 and older than the window.
  const stuck = await prisma.machine.create({
    data: {
      serialNumber: TEST_SERIAL,
      barcode: null,
      model: 'SS99',
      productionDate: new Date('2026-05-14T00:00:00'),
      status: 'AVAILABLE',
      assemblyStage: 2,
      orderNo: TEST_ORDER,
      parkStatus: 'PLANNED',
      isDemo: false
    }
  });

  const candidates = await findStuckOrders(7);
  check('findStuckOrders returns the seeded row', candidates.some((c) => c.id === stuck.id));
  check('findStuckOrders excludes stage 18', !candidates.some((c) => c.assemblyStage >= 18));

  const stuckRequests: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    stuckRequests.push(url);
    if (url.includes('hsOrderNo=')) {
      return { ok: true, status: 200, json: async () => [orderPayload()] } as any;
    }
    return { ok: true, status: 200, json: async () => [] } as any;
  }) as any;

  try {
    const summary = await refreshStuckOrders(7);
    // The real database still holds its own stuck orders, so this asserts on the test
    // order specifically rather than on the total count.
    check('stuck refresh picked up the seeded row', summary.checked >= 1, `checked ${summary.checked}`);
    check('stuck order was refreshed', summary.refreshed >= 1, JSON.stringify(summary));
    check(
      'test order is not reported missing',
      !summary.notFound.some((n) => n.includes(TEST_ORDER)),
      JSON.stringify(summary.notFound)
    );

    const searchUrl = stuckRequests.find((u) => u.includes('hsOrderNo='));
    check('per-order URL used hsOrderNo', Boolean(searchUrl && searchUrl.includes(`hsOrderNo=${TEST_ORDER}`)));
    check('per-order URL used the machine productionDate', Boolean(searchUrl && searchUrl.includes(`hxTrxDt=${TEST_DATE}`)), searchUrl ?? 'none');

    const refreshed = await prisma.machine.findUnique({
      where: { id: stuck.id },
      select: { assemblyStage: true, lastSyncAt: true }
    });
    check('stage advanced from 2 to 2-complete', refreshed?.assemblyStage === 2, `got ${refreshed?.assemblyStage}`);
    check('lastSyncAt was refreshed', refreshed?.lastSyncAt !== null);

    const history = await prisma.machineStageHistory.count({ where: { machineId: stuck.id, source: 'PLANT_SYNC' } });
    check('stage history was persisted', history === 3, `got ${history}`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('--- Cleanup --------------------------------------------------------');
  await cleanupTestRows();
  const leftovers = await prisma.machine.count({ where: { serialNumber: { startsWith: 'TEST-BC-' } } });
  check('test rows removed', leftovers === 0, `got ${leftovers}`);

  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (error) => {
    console.error('Test harness crashed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

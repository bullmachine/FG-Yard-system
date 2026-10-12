/**
 * Non-destructive demo data for the Assembly Line.
 *
 * This creates one machine per assembly stage with a full stage history so the
 * stage-history modal and the "started today" counts have something to show
 * while the plant API is unreachable.
 *
 * Safety rules this script follows:
 *  - It only ever touches rows with isDemo = true. Real synced machines are
 *    never read for update and never deleted.
 *  - It is NOT the same as prisma/seed.ts, which wipes every table.
 *  - It is idempotent. Serials are fixed (DEMO-S001..DEMO-S018) and each
 *    machine's history is replaced, so re-running never duplicates rows.
 *  - All timestamps are computed relative to the moment it runs, so the
 *    "started today" figures stay meaningful instead of going stale.
 *
 * Usage:
 *   npm run demo:seed     create or refresh the demo machines
 *   npm run demo:clear    remove every demo machine and its history
 */
import { PrismaClient } from '@prisma/client';
import {
  parsePlantDateTime,
  isTrxCompleted,
  toStageNumber
} from '../src/services/productionApiService';

const prisma = new PrismaClient();

const TOTAL_STAGES = 18;
const DEMO_SERIAL_PREFIX = 'DEMO-S';
const MINUTE = 60 * 1000;

type FinalState = 'COMPLETED' | 'IN_PROGRESS';
type Source = 'PLANT_SYNC' | 'MANUAL';

interface DemoSpec {
  stage: number;
  state: FinalState;
  /** Which row supplies the final stage. MANUAL demos the manual-advance badge. */
  source?: Source;
  /** auto = spread back from now, allToday = every stage lands today, else explicit. */
  startWhen: 'auto' | 'allToday' | 'fixed';
  daysAgo?: number;
  hour?: number;
  minute?: number;
}

/**
 * One machine per stage. The mix is deliberate so every count is non-zero:
 * seven machines are mid-operation, six of those started today, and the
 * stage 10 machine's final row comes from a manual stage advance.
 */
const SPECS: DemoSpec[] = [
  { stage: 1,  state: 'IN_PROGRESS', startWhen: 'fixed', hour: 8,  minute: 15 },
  { stage: 2,  state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 3,  state: 'COMPLETED',  startWhen: 'allToday' },
  { stage: 4,  state: 'IN_PROGRESS', startWhen: 'fixed', hour: 10, minute: 40 },
  { stage: 5,  state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 6,  state: 'IN_PROGRESS', startWhen: 'fixed', hour: 13, minute: 5 },
  { stage: 7,  state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 8,  state: 'IN_PROGRESS', startWhen: 'fixed', daysAgo: 1, hour: 15, minute: 20 },
  { stage: 9,  state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 10, state: 'COMPLETED',  startWhen: 'fixed', hour: 11, minute: 20, source: 'MANUAL' },
  { stage: 11, state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 12, state: 'IN_PROGRESS', startWhen: 'fixed', daysAgo: 2, hour: 9,  minute: 45 },
  { stage: 13, state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 14, state: 'IN_PROGRESS', startWhen: 'fixed', hour: 9,  minute: 50 },
  { stage: 15, state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 16, state: 'COMPLETED',  startWhen: 'auto' },
  { stage: 17, state: 'IN_PROGRESS', startWhen: 'fixed', hour: 14, minute: 30 },
  { stage: 18, state: 'COMPLETED',  startWhen: 'auto' }
];

// Real item/model combinations copied from the live synced machines so the
// demo rows read like genuine plant data.
const PRODUCTS = [
  { itemCode: '8004646', itemDescription: 'SS-76-BHL-2WD-AC-BS5-2SPL-HD14.25-STD', model: 'SS76', modelType: 'SS76' },
  { itemCode: '8004006', itemDescription: 'BULL SKID AV 490 NAC STD BKT  SAUDI',  model: 'BULL', modelType: 'BULL' },
  { itemCode: '8004645', itemDescription: 'SS-76-BHL-2WD-AC-BS5-2SPL-IND16.9-STD', model: 'SS76', modelType: 'SS76' }
];

/** Deterministic per-stage operation length, roughly 6-40 minutes. */
function durationMinutes(stage: number, compress: number) {
  return Math.max(1, Math.round((6 + ((stage * 17) % 34)) / compress));
}

/** Deterministic wait between operations, roughly 12-90 minutes. */
function gapMinutes(stage: number, compress: number) {
  return Math.max(1, Math.round((12 + ((stage * 29) % 78)) / compress));
}

interface HistoryRow {
  stage: number;
  startedAt: Date;
  endedAt: Date | null;
  completedQty: string;
  isCompleted: boolean;
  source: Source;
}

/**
 * Walk backwards from the final stage so earlier operations always precede it,
 * regardless of how far back the final stage is anchored.
 */
function buildBackwards(finalStage: number, finalStart: Date, state: FinalState, source: Source, compress: number): HistoryRow[] {
  const rows: HistoryRow[] = [];

  if (state === 'COMPLETED') {
    const endedAt = new Date(finalStart.getTime() + durationMinutes(finalStage, compress) * MINUTE);
    rows.push({
      stage: finalStage,
      startedAt: finalStart,
      endedAt,
      completedQty: '1.00',
      isCompleted: true,
      source
    });
  } else {
    rows.push({
      stage: finalStage,
      startedAt: finalStart,
      endedAt: null,
      completedQty: '0.00',
      isCompleted: false,
      source
    });
  }

  let cursor = finalStart;
  for (let stage = finalStage - 1; stage >= 1; stage--) {
    const endedAt = new Date(cursor.getTime() - gapMinutes(stage, compress) * MINUTE);
    const startedAt = new Date(endedAt.getTime() - durationMinutes(stage, compress) * MINUTE);
    rows.push({
      stage,
      startedAt,
      endedAt,
      completedQty: '1.00',
      isCompleted: true,
      source: 'PLANT_SYNC'
    });
    cursor = startedAt;
  }

  return rows.sort((a, b) => a.stage - b.stage);
}

/**
 * Walk forward, then shift the whole timeline back if it would run past now.
 * Guarantees every timestamp is in the past.
 */
function buildForwards(finalStage: number, start: Date, compress: number): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let cursor = start;

  for (let stage = 1; stage <= finalStage; stage++) {
    const endedAt = new Date(cursor.getTime() + durationMinutes(stage, compress) * MINUTE);
    rows.push({
      stage,
      startedAt: cursor,
      endedAt,
      completedQty: '1.00',
      isCompleted: true,
      source: 'PLANT_SYNC'
    });
    cursor = new Date(endedAt.getTime() + gapMinutes(stage, compress) * MINUTE);
  }

  return rows;
}

function clampToPast(date: Date, now: Date, fallbackMinutesAgo = 45): Date {
  if (date.getTime() < now.getTime()) return date;
  return new Date(now.getTime() - fallbackMinutesAgo * MINUTE);
}

/** Anchor an absolute time N days back at a wall-clock time, never in the future. */
function anchorAt(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return clampToPast(d, now);
}

/**
 * The plant only ever reports whole seconds, so demo timestamps are truncated
 * to match. Otherwise seeded rows would carry milliseconds the real sync can
 * never produce, and they would not round-trip through the plant parser.
 */
function normalizeToPlantPrecision(rows: HistoryRow[]): HistoryRow[] {
  for (const row of rows) {
    row.startedAt = new Date(Math.floor(row.startedAt.getTime() / 1000) * 1000);
    if (row.endedAt) {
      row.endedAt = new Date(Math.floor(row.endedAt.getTime() / 1000) * 1000);
    }
  }
  return rows;
}

function buildRows(spec: DemoSpec, now: Date): HistoryRow[] {
  if (spec.startWhen === 'allToday') {
    // A fast machine that cleared every stage just after midnight, so all of
    // its operations count towards "started today".
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const start = clampToPast(new Date(dayStart.getTime() + 2 * MINUTE), now, 3);
    const rows = buildForwards(spec.stage, start, 20);

    // Never let the walk run past now, even when seeding just after midnight.
    const lastEnd = rows[rows.length - 1].endedAt as Date;
    if (lastEnd.getTime() > now.getTime()) {
      const shift = lastEnd.getTime() - now.getTime() + MINUTE;
      for (const row of rows) {
        row.startedAt = new Date(row.startedAt.getTime() - shift);
        row.endedAt = row.endedAt ? new Date(row.endedAt.getTime() - shift) : null;
      }
    }
    return normalizeToPlantPrecision(rows);
  }

  if (spec.startWhen === 'fixed') {
    const start = anchorAt(now, spec.daysAgo ?? 0, spec.hour ?? 9, spec.minute ?? 0);
    return normalizeToPlantPrecision(
      buildBackwards(spec.stage, start, spec.state, spec.source ?? 'PLANT_SYNC', 1)
    );
  }

  // auto: start far enough back that the forward walk finishes before now.
  let span = 0;
  for (let s = 1; s <= spec.stage; s++) {
    span += durationMinutes(s, 1) + gapMinutes(s, 1);
  }
  const bufferMinutes = 6 * 60 + spec.stage * 100;
  const start = new Date(now.getTime() - (span + bufferMinutes) * MINUTE);
  const rows = buildForwards(spec.stage, start, 1);

  // If the walk still overshoots, slide the whole timeline back.
  const lastEnd = rows[rows.length - 1].endedAt as Date;
  if (lastEnd.getTime() > now.getTime()) {
    const shift = lastEnd.getTime() - now.getTime() + 10 * MINUTE;
    for (const row of rows) {
      row.startedAt = new Date(row.startedAt.getTime() - shift);
      row.endedAt = row.endedAt ? new Date(row.endedAt.getTime() - shift) : null;
    }
  }

  return normalizeToPlantPrecision(rows);
}

/** Render a Date the way the plant does, so the self-check exercises the real format. */
function formatPlantTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

async function clearDemo() {
  // History rows cascade with the machine, so one delete is enough.
  const deleted = await prisma.machine.deleteMany({ where: { isDemo: true } });
  console.log(`Removed ${deleted.count} demo machine(s) and their stage history.`);
}

async function seedDemo() {
  const now = new Date();
  const syncedAt = new Date(now.getTime() - 90 * MINUTE);

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  // Sweep any demo rows left behind by an older version of this script.
  await prisma.machine.deleteMany({
    where: { isDemo: true, serialNumber: { not: { startsWith: DEMO_SERIAL_PREFIX } } }
  });

  let startedToday = 0;
  let inProgress = 0;
  let historyRows = 0;

  for (const spec of SPECS) {
    const serial = `${DEMO_SERIAL_PREFIX}${String(spec.stage).padStart(3, '0')}`;
    const rows = buildRows(spec, now);
    const product = PRODUCTS[spec.stage % PRODUCTS.length];

    const data = {
      barcode: `9990${String(spec.stage).padStart(4, '0')}`,
      model: product.model,
      machineType: product.modelType,
      modelType: product.modelType,
      itemCode: product.itemCode,
      itemDescription: product.itemDescription,
      orderNo: `9000${String(100000 + spec.stage)}`,
      productionOrderId: String(9000000 + spec.stage),
      // The machine is at the stage it has reached, so the table and the
      // history modal agree on where it is.
      assemblyStage: spec.stage,
      productionDate: rows[0].startedAt,
      status: 'AVAILABLE' as const,
      parkStatus: (spec.stage >= 18 ? 'READY_TO_MOVE' : 'PLANNED') as 'READY_TO_MOVE' | 'PLANNED',
      lastSyncAt: syncedAt,
      isDemo: true
    };

    const machine = await prisma.machine.upsert({
      where: { serialNumber: serial },
      create: { serialNumber: serial, ...data },
      update: data
    });

    // Replace history wholesale so re-running refreshes timestamps in place.
    await prisma.machineStageHistory.deleteMany({ where: { machineId: machine.id } });
    await prisma.machineStageHistory.createMany({
      data: rows.map((row) => ({
        machineId: machine.id,
        stage: row.stage,
        operationSeqNo: String(row.stage * 10),
        workCenter: `STAGE-${row.stage}`,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        completedQty: row.completedQty,
        isCompleted: row.isCompleted,
        source: row.source,
        syncedAt
      }))
    });

    for (const row of rows) {
      if (row.startedAt >= dayStart) startedToday++;
      if (!row.isCompleted) inProgress++;
    }
    historyRows += rows.length;

    // Self-check: the stored rows must satisfy the same rules the sync and the
    // history endpoint rely on, otherwise the demo screen would disagree with
    // the production logic.
    for (const row of rows) {
      const stage = toStageNumber(String(row.stage * 10));
      if (stage !== row.stage) {
        throw new Error(`${serial}: stage ${row.stage} did not round-trip through toStageNumber`);
      }
      const parsedStart = parsePlantDateTime(formatPlantTimestamp(row.startedAt));
      if (!parsedStart || parsedStart.getTime() !== row.startedAt.getTime()) {
        throw new Error(`${serial}: stage ${row.stage} start time did not round-trip`);
      }
      const derived = isTrxCompleted({
        operation_seq_no: String(row.stage * 10),
        start_dt_time: formatPlantTimestamp(row.startedAt),
        end_dt_time: row.endedAt ? formatPlantTimestamp(row.endedAt) : '',
        work_center_cd: `STAGE-${row.stage}`,
        operation_completed_qty: row.completedQty
      });
      if (derived !== row.isCompleted) {
        throw new Error(
          `${serial}: stage ${row.stage} isCompleted=${row.isCompleted} but the plant rule derives ${derived}`
        );
      }
    }

    console.log(
      `  ${serial}  stage ${String(spec.stage).padStart(2)}  ` +
      `${spec.state === 'IN_PROGRESS' ? 'in progress' : 'complete '}  ` +
      `${rows.length} history row(s)` +
      `${spec.source === 'MANUAL' ? '  [manual]' : ''}`
    );
  }

  const total = await prisma.machine.count({ where: { isDemo: true } });
  const real = await prisma.machine.count({ where: { isDemo: false } });

  console.log(`\nSeeded ${total} demo machine(s) with ${historyRows} history row(s).`);
  console.log(`Operations started today: ${startedToday}`);
  console.log(`Operations in progress:   ${inProgress}`);
  console.log(`Real machines untouched:   ${real}`);
  console.log('\nRun "npm run demo:clear" to remove the demo rows.');
}

async function main() {
  if (process.argv.includes('--clear')) {
    await clearDemo();
    return;
  }
  console.log('Seeding demo assembly data (non-destructive)...\n');
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

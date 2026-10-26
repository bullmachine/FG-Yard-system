import prisma from '../lib/prisma';

/**
 * In-yard stock in FIFO order: the machine that came into the yard first is first out.
 * Shared by the Yard Stock screen and dispatch-plan reservations so both always agree
 * on which machine is next.
 *
 * The FIFO date ("inward date") is, in order of preference:
 *   1. ACTUAL - yardInwardAt, entered by hand for stock that predates go-live
 *   2. GATE   - the machine's first authorized gate check-in (a machine that left
 *               for testing or repair keeps its original date when it returns)
 *   3. STAGE18 - completion of assembly stage 18, a stand-in for old stock
 * A machine with none of these sorts last and is reported as UNKNOWN.
 *
 * A machine is free for dispatch only when it is PARKED_VERIFIED, not already planned
 * for dispatch, has no open exit request and is not on a returned-after-dispatch hold.
 */

export type InwardSource = 'ACTUAL' | 'GATE' | 'STAGE18' | 'UNKNOWN';

const IN_SLOT_STATUSES = ['PARKED_VERIFIED', 'PARKED_PENDING', 'PARKED_REJECTED'] as const;

export interface StockRow {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string;
  fertCategory: string | null;
  parkStatus: string;
  verified: boolean;
  reservedFor: { planId: string; planNo: string } | null;
  exitPending: boolean;
  available: boolean;
  yard: { id: string; name: string } | null;
  row: number | null;
  col: number | null;
  inwardAt: Date | null;
  inwardSource: InwardSource;
  daysInYard: number | null;
  // Latest gate IN when the machine has left the yard before and come back; the FIFO
  // date above stays the first inward, so this is shown alongside it, not instead.
  returnedAt: Date | null;
  // Came back after dispatch and not yet cleared: not free stock.
  returnHoldAt: Date | null;
}

export function machineModelType(m: { modelType: string | null; modelMaster?: { modelType: string | null } | null }) {
  return m.modelType || m.modelMaster?.modelType || 'Unclassified';
}

export async function loadStock(opts: { yardId?: string | null; includeDemo?: boolean; modelType?: string } = {}): Promise<StockRow[]> {
  const machines = await prisma.machine.findMany({
    where: {
      currentSlotId: { not: null },
      parkStatus: { in: [...IN_SLOT_STATUSES] },
      ...(opts.includeDemo ? {} : { isDemo: false }),
      ...(opts.yardId ? { currentSlot: { yardId: opts.yardId } } : {})
    },
    select: {
      id: true,
      serialNumber: true,
      model: true,
      modelType: true,
      fertCategory: true,
      parkStatus: true,
      yardInwardAt: true,
      returnHoldAt: true,
      modelMaster: { select: { modelType: true } },
      currentSlot: { select: { row: true, col: true, yard: { select: { id: true, name: true } } } },
      dispatchItems: {
        where: { status: { in: ['PLANNED', 'DRIVER_ASSIGNED'] } },
        select: { plan: { select: { id: true, planNo: true } } },
        take: 1
      },
      exitRequests: { where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { id: true }, take: 1 }
    }
  });

  const scoped = opts.modelType ? machines.filter((m) => machineModelType(m) === opts.modelType) : machines;
  const ids = scoped.map((m) => m.id);

  // First and latest authorized check-in per machine, and its latest check-out.
  const gateRows = ids.length
    ? await prisma.gateLog.groupBy({
        by: ['machineId', 'direction'],
        where: { machineId: { in: ids }, result: 'AUTHORIZED' },
        _min: { createdAt: true },
        _max: { createdAt: true }
      })
    : [];
  const firstGate = new Map<string, Date | null>();
  const lastIn = new Map<string, Date | null>();
  const lastOut = new Map<string, Date | null>();
  for (const r of gateRows) {
    if (r.direction === 'IN') { firstGate.set(r.machineId, r._min.createdAt); lastIn.set(r.machineId, r._max.createdAt); }
    else lastOut.set(r.machineId, r._max.createdAt);
  }

  // Stage 18 is done when its last operation ended; fall back to its start.
  const stageRows = ids.length
    ? await prisma.machineStageHistory.groupBy({
        by: ['machineId'],
        where: { machineId: { in: ids }, stage: 18 },
        _max: { endedAt: true, startedAt: true }
      })
    : [];
  const stage18 = new Map(stageRows.map((r) => [r.machineId, r._max.endedAt ?? r._max.startedAt]));

  const now = Date.now();
  const rows: StockRow[] = scoped.map((m) => {
    let inwardAt: Date | null = null;
    let source: InwardSource = 'UNKNOWN';
    if (m.yardInwardAt) { inwardAt = m.yardInwardAt; source = 'ACTUAL'; }
    else if (firstGate.get(m.id)) { inwardAt = firstGate.get(m.id)!; source = 'GATE'; }
    else if (stage18.get(m.id)) { inwardAt = stage18.get(m.id)!; source = 'STAGE18'; }

    const plan = m.dispatchItems[0]?.plan ?? null;
    const verified = m.parkStatus === 'PARKED_VERIFIED';
    const exitPending = m.exitRequests.length > 0;
    const inAt = lastIn.get(m.id);
    const outAt = lastOut.get(m.id);
    const returnedAt = inAt && outAt && inAt > outAt ? inAt : null;

    return {
      id: m.id,
      serialNumber: m.serialNumber,
      model: m.model,
      modelType: machineModelType(m),
      fertCategory: m.fertCategory,
      parkStatus: m.parkStatus,
      verified,
      reservedFor: plan ? { planId: plan.id, planNo: plan.planNo } : null,
      exitPending,
      available: verified && !plan && !exitPending && !m.returnHoldAt,
      yard: m.currentSlot?.yard ?? null,
      row: m.currentSlot?.row ?? null,
      col: m.currentSlot?.col ?? null,
      inwardAt,
      inwardSource: source,
      daysInYard: inwardAt ? Math.max(0, Math.floor((now - inwardAt.getTime()) / 86_400_000)) : null,
      returnedAt,
      returnHoldAt: m.returnHoldAt
    };
  });

  // Oldest first; undated machines last, then by serial so the order is stable.
  rows.sort((a, b) => {
    if (a.inwardAt && b.inwardAt) return a.inwardAt.getTime() - b.inwardAt.getTime() || a.serialNumber.localeCompare(b.serialNumber);
    if (a.inwardAt) return -1;
    if (b.inwardAt) return 1;
    return a.serialNumber.localeCompare(b.serialNumber);
  });

  return rows;
}

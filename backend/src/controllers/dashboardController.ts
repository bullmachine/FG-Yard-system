import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { loadStock } from '../services/yardStockService';
import { getSettings } from '../services/settingsService';
import { sapMismatchSummary } from '../services/sapCheckService';

/**
 * Main dashboard: FG yard only. Assembly data is deliberately left out; the yard's
 * story starts when a machine is released to the yard (READY_TO_MOVE) and ends when
 * it leaves the plant through the main gate.
 *
 * Every list is capped and reports its full count, so a short list is never taken
 * for the whole picture.
 */

const LIST_CAP = 50;
const IST_OFFSET_MS = 330 * 60_000;

// Midnight today in India, whatever the server's own time zone is.
function startOfTodayIst(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

const machineSelect = {
  id: true,
  serialNumber: true,
  model: true,
  modelType: true,
  parkStatus: true,
  modelMaster: { select: { modelType: true } },
  currentSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
  plannedSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
  driver: { select: { name: true } }
} as const;

type MachineSel = {
  id: string;
  serialNumber: string;
  model: string;
  modelType: string | null;
  parkStatus: string;
  modelMaster: { modelType: string | null } | null;
  currentSlot: { row: number; col: number; yard: { name: string } } | null;
  plannedSlot: { row: number; col: number; yard: { name: string } } | null;
  driver: { name: string } | null;
};

function row(m: MachineSel, since: Date | null = null) {
  const slot = m.currentSlot ?? m.plannedSlot;
  return {
    id: m.id,
    serialNumber: m.serialNumber,
    model: m.model,
    modelType: m.modelType || m.modelMaster?.modelType || 'Unclassified',
    parkStatus: m.parkStatus,
    yard: slot?.yard.name ?? null,
    row: slot?.row ?? null,
    col: slot?.col ?? null,
    slotReservedOnly: !m.currentSlot && !!m.plannedSlot,
    driver: m.driver?.name ?? null,
    since: since ? since.toISOString() : null
  };
}

const list = <T>(items: T[]) => ({ count: items.length, items: items.slice(0, LIST_CAP) });

const TREND_DAYS = 7;
const ACTIVITY_CAP = 12;

/** YYYY-MM-DD of a moment, in India time. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last `days` India dates, oldest first, each with zero counts. */
export function emptyTrend(today: Date, days = TREND_DAYS) {
  return Array.from({ length: days }, (_, i) => ({
    day: istDay(new Date(today.getTime() - (days - 1 - i) * 86_400_000)),
    gateIn: 0,
    gateOut: 0,
    mainGateOut: 0
  }));
}

/** Gate in / gate out / main gate out per day for the last 7 days. */
async function loadTrend(today: Date) {
  const from = new Date(today.getTime() - (TREND_DAYS - 1) * 86_400_000);
  const [gate, mainGate] = await Promise.all([
    prisma.gateLog.findMany({
      where: { result: 'AUTHORIZED', createdAt: { gte: from }, machine: { isDemo: false } },
      select: { direction: true, createdAt: true }
    }),
    prisma.dispatchItem.findMany({
      where: { status: 'MAIN_GATE_OUT', mainGateOutAt: { gte: from }, machine: { isDemo: false } },
      select: { mainGateOutAt: true }
    })
  ]);
  const days = emptyTrend(today);
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const g of gate) {
    const d = byDay.get(istDay(g.createdAt));
    if (d) d[g.direction === 'OUT' ? 'gateOut' : 'gateIn']++;
  }
  for (const m of mainGate) {
    const d = m.mainGateOutAt && byDay.get(istDay(m.mainGateOutAt));
    if (d) d.mainGateOut++;
  }
  return days;
}

type Activity = { at: string; kind: 'GATE_IN' | 'GATE_OUT' | 'VERIFIED' | 'REJECTED' | 'PDI_PASS' | 'PDI_HOLD' | 'MAIN_GATE_OUT'; serialNumber: string; by: string | null; detail: string | null };

/** The latest yard events of the last 7 days, newest first. */
async function loadActivity(now: Date): Promise<Activity[]> {
  const since = new Date(now.getTime() - TREND_DAYS * 86_400_000);
  const [gate, checks, pdi, mainGate] = await Promise.all([
    prisma.gateLog.findMany({
      where: { result: 'AUTHORIZED', createdAt: { gte: since }, machine: { isDemo: false } },
      select: { createdAt: true, direction: true, machine: { select: { serialNumber: true } }, driver: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }, take: ACTIVITY_CAP
    }),
    prisma.securityVerification.findMany({
      where: { verifiedAt: { gte: since }, machine: { isDemo: false } },
      select: { verifiedAt: true, status: true, comments: true, machine: { select: { serialNumber: true } }, user: { select: { name: true } }, slot: { select: { row: true, col: true, yard: { select: { name: true } } } } },
      orderBy: { verifiedAt: 'desc' }, take: ACTIVITY_CAP
    }),
    prisma.dispatchItem.findMany({
      where: { pdiAt: { gte: since }, machine: { isDemo: false } },
      select: { pdiAt: true, pdiStatus: true, pdiRemark: true, machine: { select: { serialNumber: true } }, pdiBy: { select: { name: true } } },
      orderBy: { pdiAt: 'desc' }, take: ACTIVITY_CAP
    }),
    prisma.dispatchItem.findMany({
      where: { mainGateOutAt: { gte: since }, status: 'MAIN_GATE_OUT', machine: { isDemo: false } },
      select: { mainGateOutAt: true, mainGateSource: true, machine: { select: { serialNumber: true } }, mainGateOutBy: { select: { name: true } }, plan: { select: { planNo: true } } },
      orderBy: { mainGateOutAt: 'desc' }, take: ACTIVITY_CAP
    })
  ]);
  const slotText = (s: { row: number; col: number; yard: { name: string } }) => `${s.yard.name} ${String.fromCharCode(64 + s.row)}${s.col}`;
  const all: Activity[] = [
    ...gate.map((g) => ({ at: g.createdAt.toISOString(), kind: (g.direction === 'OUT' ? 'GATE_OUT' : 'GATE_IN') as Activity['kind'], serialNumber: g.machine.serialNumber, by: g.driver?.name ?? null, detail: null })),
    ...checks.map((c) => ({ at: c.verifiedAt.toISOString(), kind: (c.status === 'APPROVED' ? 'VERIFIED' : 'REJECTED') as Activity['kind'], serialNumber: c.machine.serialNumber, by: c.user?.name ?? null, detail: c.status === 'APPROVED' ? slotText(c.slot) : c.comments })),
    ...pdi.map((p) => ({ at: p.pdiAt!.toISOString(), kind: (p.pdiStatus === 'PASSED' ? 'PDI_PASS' : 'PDI_HOLD') as Activity['kind'], serialNumber: p.machine.serialNumber, by: p.pdiBy?.name ?? null, detail: p.pdiStatus === 'PASSED' ? null : p.pdiRemark })),
    ...mainGate.map((m) => ({ at: m.mainGateOutAt!.toISOString(), kind: 'MAIN_GATE_OUT' as const, serialNumber: m.machine.serialNumber, by: m.mainGateOutBy?.name ?? (m.mainGateSource === 'API' ? 'Main gate system' : null), detail: m.plan.planNo }))
  ];
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_CAP);
}

/** Plans with machines still on the way, oldest first: planned / out of FG yard / main gate out. */
async function loadOpenPlans() {
  const plans = await prisma.dispatchPlan.findMany({
    where: { items: { some: { status: { in: ['PLANNED', 'DRIVER_ASSIGNED', 'OUT_OF_YARD'] } } } },
    select: { id: true, planNo: true, soNumber: true, createdAt: true, items: { where: { status: { not: 'CANCELLED' } }, select: { status: true, pdiStatus: true } } },
    orderBy: { createdAt: 'asc' },
    take: 8
  });
  const total = await prisma.dispatchPlan.count({ where: { items: { some: { status: { in: ['PLANNED', 'DRIVER_ASSIGNED', 'OUT_OF_YARD'] } } } } });
  return {
    count: total,
    items: plans.map((p) => ({
      id: p.id,
      planNo: p.planNo,
      soNumber: p.soNumber,
      createdAt: p.createdAt.toISOString(),
      total: p.items.length,
      inYard: p.items.filter((i) => i.status === 'PLANNED' || i.status === 'DRIVER_ASSIGNED').length,
      outOfYard: p.items.filter((i) => i.status === 'OUT_OF_YARD').length,
      mainGateOut: p.items.filter((i) => i.status === 'MAIN_GATE_OUT').length,
      pdiHold: p.items.filter((i) => i.status === 'OUT_OF_YARD' && i.pdiStatus === 'HOLD').length
    }))
  };
}

export const getFgDashboard = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = startOfTodayIst(now);
    const settings = await getSettings();

    const [yards, pipeline, stock, dispatchItems, gateToday, exitPending, mainGateToday, trend, activity, openPlans] = await Promise.all([
      prisma.yard.findMany({ select: { id: true, name: true, slots: { select: { status: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.machine.findMany({
        where: { isDemo: false, parkStatus: { in: ['READY_TO_MOVE', 'IN_TRANSIT', 'AT_GATE', 'PARKED_PENDING', 'PARKED_REJECTED'] } },
        select: machineSelect
      }),
      loadStock(),
      prisma.dispatchItem.findMany({
        where: { status: { in: ['PLANNED', 'DRIVER_ASSIGNED', 'OUT_OF_YARD'] }, machine: { isDemo: false } },
        select: {
          id: true,
          status: true,
          gateOutAt: true,
          pdiStatus: true,
          driver: { select: { name: true } },
          plan: { select: { planNo: true } },
          line: { select: { modelType: true } },
          machine: { select: { serialNumber: true, model: true } }
        },
        orderBy: { gateOutAt: 'asc' }
      }),
      prisma.gateLog.groupBy({
        by: ['direction'],
        where: { result: 'AUTHORIZED', createdAt: { gte: today }, machine: { isDemo: false } },
        _count: { _all: true }
      }),
      prisma.machineExitRequest.count({ where: { status: 'PENDING' } }),
      prisma.dispatchItem.count({ where: { status: 'MAIN_GATE_OUT', mainGateOutAt: { gte: today }, machine: { isDemo: false } } }),
      loadTrend(today),
      loadActivity(now),
      loadOpenPlans()
    ]);

    // Slot counts per yard, with the plant total.
    const yardRows = yards.map((y) => {
      const counts: Record<string, number> = {};
      for (const s of y.slots) counts[s.status] = (counts[s.status] ?? 0) + 1;
      return { id: y.id, name: y.name, totalSlots: y.slots.length, slotCounts: counts };
    });
    const slotTotal = (status: string) => yardRows.reduce((n, y) => n + (y.slotCounts[status] ?? 0), 0);

    // Machines on their way into a slot. "Since" for in-transit is the latest gate IN,
    // which is also what the stuck-in-transit alert measures from.
    const transitIds = pipeline.filter((m) => m.parkStatus === 'IN_TRANSIT').map((m) => m.id);
    const lastIn = transitIds.length
      ? await prisma.gateLog.groupBy({
          by: ['machineId'],
          where: { machineId: { in: transitIds }, direction: 'IN', result: 'AUTHORIZED' },
          _max: { createdAt: true }
        })
      : [];
    const lastInBy = new Map(lastIn.map((r) => [r.machineId, r._max.createdAt]));
    const stuckMs = settings.inTransitAlertMinutes * 60_000;

    const readyToMove = pipeline.filter((m) => m.parkStatus === 'READY_TO_MOVE').map((m) => row(m));
    const inTransit = pipeline
      .filter((m) => m.parkStatus === 'IN_TRANSIT' || m.parkStatus === 'AT_GATE')
      .map((m) => row(m, lastInBy.get(m.id) ?? null))
      .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
    const stuck = stuckMs > 0
      ? inTransit.filter((m) => m.parkStatus === 'IN_TRANSIT' && m.since && now.getTime() - Date.parse(m.since) > stuckMs)
      : [];
    const awaitingVerify = pipeline.filter((m) => m.parkStatus === 'PARKED_PENDING').map((m) => row(m));
    const rejected = pipeline.filter((m) => m.parkStatus === 'PARKED_REJECTED').map((m) => row(m));

    // In-yard stock from the same FIFO service the Yard Stock screen uses.
    const stockRow = (r: (typeof stock)[number]) => ({
      id: r.id,
      serialNumber: r.serialNumber,
      model: r.model,
      modelType: r.modelType,
      parkStatus: r.parkStatus,
      yard: r.yard?.name ?? null,
      row: r.row,
      col: r.col,
      slotReservedOnly: false,
      driver: null,
      since: r.inwardAt ? r.inwardAt.toISOString() : null,
      daysInYard: r.daysInYard
    });
    const free = stock.filter((r) => r.available);
    const planned = stock.filter((r) => r.reservedFor);
    const returnHold = stock.filter((r) => r.verified && !r.reservedFor && !r.exitPending && r.returnHoldAt);

    const byModelType = new Map<string, { modelType: string; total: number; free: number; planned: number; oldestDays: number | null }>();
    for (const r of stock) {
      const g = byModelType.get(r.modelType) ?? { modelType: r.modelType, total: 0, free: 0, planned: 0, oldestDays: null };
      g.total++;
      if (r.available) {
        g.free++;
        // Stock is FIFO-sorted, so the first free machine seen is the oldest.
        if (g.oldestDays === null && r.daysInYard !== null) g.oldestDays = r.daysInYard;
      }
      if (r.reservedFor) g.planned++;
      byModelType.set(r.modelType, g);
    }

    const ageBands = [
      { label: '0–7 days', min: 0, max: 7 },
      { label: '8–15 days', min: 8, max: 15 },
      { label: '16–30 days', min: 16, max: 30 },
      { label: 'Over 30 days', min: 31, max: Infinity }
    ].map((b) => ({ label: b.label, count: stock.filter((r) => r.daysInYard !== null && r.daysInYard >= b.min && r.daysInYard <= b.max).length }));
    const undated = stock.filter((r) => r.daysInYard === null).length;

    // Dispatch: planned machines still in the yard, and machines out of the FG yard but
    // not yet through the main gate. Overdue uses the same hours as the e-mail alert.
    const alertMs = settings.dispatchAlertHours * 3_600_000;
    const dispatchRow = (i: (typeof dispatchItems)[number]) => ({
      id: i.id,
      status: i.status,
      planNo: i.plan.planNo,
      modelType: i.line.modelType,
      serialNumber: i.machine.serialNumber,
      model: i.machine.model,
      driver: i.driver?.name ?? null,
      gateOutAt: i.gateOutAt ? i.gateOutAt.toISOString() : null,
      overdue: i.status === 'OUT_OF_YARD' && !!i.gateOutAt && alertMs > 0 && now.getTime() - i.gateOutAt.getTime() > alertMs,
      pdiStatus: i.pdiStatus
    });
    const toLoad = dispatchItems.filter((i) => i.status !== 'OUT_OF_YARD').map(dispatchRow);
    const awaitingMainGate = dispatchItems.filter((i) => i.status === 'OUT_OF_YARD').map(dispatchRow);
    const overdue = awaitingMainGate.filter((i) => i.overdue);
    const pdiHold = awaitingMainGate.filter((i) => i.pdiStatus === 'HOLD');

    const gateCount = (direction: string) => gateToday.find((g) => g.direction === direction)?._count._all ?? 0;

    res.json({
      generatedAt: now.toISOString(),
      settings: { inTransitAlertMinutes: settings.inTransitAlertMinutes, dispatchAlertHours: settings.dispatchAlertHours },
      slots: {
        total: yardRows.reduce((n, y) => n + y.totalSlots, 0),
        available: slotTotal('AVAILABLE'),
        reserved: slotTotal('RESERVED'),
        occupied: slotTotal('OCCUPIED'),
        dispatchReady: slotTotal('DISPATCH_READY')
      },
      yards: yardRows,
      today: { gateIn: gateCount('IN'), gateOut: gateCount('OUT'), mainGateOut: mainGateToday },
      inbound: {
        readyToMove: list(readyToMove),
        inTransit: list(inTransit),
        stuck: list(stuck),
        awaitingVerify: list(awaitingVerify),
        rejected: list(rejected)
      },
      stock: {
        inYard: list(stock.map(stockRow)),
        free: list(free.map(stockRow)),
        planned: list(planned.map(stockRow)),
        returnHold: list(returnHold.map(stockRow)),
        exitPending: stock.filter((r) => r.exitPending).length,
        byModelType: [...byModelType.values()].sort((a, b) => b.total - a.total || a.modelType.localeCompare(b.modelType)),
        ageBands,
        undated
      },
      dispatch: {
        toLoad: list(toLoad),
        awaitingMainGate: list(awaitingMainGate),
        overdue: list(overdue),
        pdiHold: list(pdiHold),
        openPlans
      },
      trend,
      activity,
      exitRequestsPending: exitPending,
      // A failing SAP check must not take the dashboard down with it.
      sapCheck: await sapMismatchSummary().catch(() => null)
    });
  } catch (error) {
    console.error('getFgDashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

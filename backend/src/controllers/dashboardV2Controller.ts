import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';

/**
 * Second dashboard, built alongside the current one until it replaces it. Every card
 * returns its count, a model-type breakdown and the full detail rows in one response:
 * the machine counts are in the hundreds, so the client can page and search locally
 * and the card total always equals the listing length.
 */

interface Filters {
  machineType?: string;
  fertNo?: string;
  driverId?: string;
  from?: Date;
  to?: Date;
}

const PRE_INWARD_STATUSES = ['PLANNED', 'READY_TO_MOVE'] as const;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** YYYY-MM-DD read as a whole local day, so "to" includes everything on that date. */
function day(value: unknown, endOfDay: boolean): Date | undefined {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return isNaN(d.getTime()) ? undefined : d;
}

function readFilters(req: Request): Filters {
  return {
    machineType: text(req.query.machineType),
    fertNo: text(req.query.fertNo),
    driverId: text(req.query.driverId),
    from: day(req.query.from, false),
    to: day(req.query.to, true),
  };
}

function machineWhere(f: Filters): Prisma.MachineWhereInput {
  return {
    isDemo: false,
    ...(f.machineType ? { machineType: f.machineType } : {}),
    ...(f.fertNo ? { itemCode: f.fertNo } : {}),
    ...(f.driverId ? { driverId: f.driverId } : {}),
  };
}

/**
 * A machine without an event date cannot be placed in a period, so it is left out
 * whenever a period is chosen and kept when none is.
 */
function inPeriod(date: Date | null, f: Filters): boolean {
  if (!f.from && !f.to) return true;
  if (!date) return false;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  return true;
}

function ageDays(date: Date | null, now: Date): number | null {
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
}

function modelTypeOf(m: { modelType: string | null; model: string }): string {
  return m.modelType || m.model || 'Unknown';
}

function byModelType(rows: { modelType: string }[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.modelType, (counts.get(r.modelType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([modelType, count]) => ({ modelType, count }))
    .sort((a, b) => b.count - a.count || a.modelType.localeCompare(b.modelType));
}

const machineSelect = {
  id: true,
  serialNumber: true,
  model: true,
  modelType: true,
  machineType: true,
  itemCode: true,
  itemDescription: true,
  assemblyStage: true,
  parkStatus: true,
  currentSlotId: true,
  driver: { select: { name: true, employeeCode: true } },
} satisfies Prisma.MachineSelect;

type MachineBase = Prisma.MachineGetPayload<{ select: typeof machineSelect }>;

function baseRow(m: MachineBase) {
  return {
    id: m.id,
    serialNumber: m.serialNumber,
    model: m.model,
    modelType: modelTypeOf(m),
    machineType: m.machineType,
    fertNo: m.itemCode,
    fertDescription: m.itemDescription,
    assemblyStage: m.assemblyStage,
    parkStatus: m.parkStatus,
    driverName: m.driver?.name ?? null,
    driverCode: m.driver?.employeeCode ?? null,
  };
}

/** Card 1: machines physically in a yard slot. Event date = gate inward. */
async function inYard(f: Filters, now: Date) {
  const machines = await prisma.machine.findMany({
    where: { ...machineWhere(f), currentSlotId: { not: null } },
    select: {
      ...machineSelect,
      currentSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
      gateLogs: {
        where: { direction: 'IN', result: 'AUTHORIZED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  // Machines placed by hand (Allocate) never passed the gate; their inward date is the
  // movement that put them in the slot they are in now.
  const noGate = machines.filter((m) => m.gateLogs.length === 0 && m.currentSlotId);
  const fallback = new Map<string, Date>();
  if (noGate.length > 0) {
    const moves = await prisma.movement.findMany({
      where: { OR: noGate.map((m) => ({ machineId: m.id, toSlotId: m.currentSlotId! })) },
      orderBy: { timestamp: 'desc' },
      select: { machineId: true, timestamp: true },
    });
    for (const mv of moves) if (!fallback.has(mv.machineId)) fallback.set(mv.machineId, mv.timestamp);
  }

  return machines
    .map((m) => {
      const inwardAt = m.gateLogs[0]?.createdAt ?? fallback.get(m.id) ?? null;
      return {
        ...baseRow(m),
        yardName: m.currentSlot?.yard.name ?? null,
        slotRow: m.currentSlot?.row ?? null,
        slotCol: m.currentSlot?.col ?? null,
        eventAt: inwardAt,
        ageDays: ageDays(inwardAt, now),
      };
    })
    .filter((r) => inPeriod(r.eventAt, f))
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
}

/** Card 2: stage 18 cleared but not yet inwarded at the gate. Event date = stage 18 completion. */
async function stage18Pending(f: Filters, now: Date) {
  const machines = await prisma.machine.findMany({
    where: { ...machineWhere(f), assemblyStage: { gte: 18 }, parkStatus: { in: [...PRE_INWARD_STATUSES] } },
    select: {
      ...machineSelect,
      barcode: true,
      stageHistory: {
        where: { stage: 18 },
        orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }],
        take: 1,
        select: { endedAt: true, startedAt: true },
      },
    },
  });

  return machines
    .map((m) => {
      const clearedAt = m.stageHistory[0]?.endedAt ?? m.stageHistory[0]?.startedAt ?? null;
      return {
        ...baseRow(m),
        hasBarcode: !!m.barcode && m.barcode.trim() !== '',
        eventAt: clearedAt,
        ageDays: ageDays(clearedAt, now),
      };
    })
    .filter((r) => inPeriod(r.eventAt, f))
    .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
}

/**
 * Card 3: free yard space. A slot has no machine type, FERT, driver or event date, so
 * the filters do not apply: this is always the live position.
 */
async function freeSpace() {
  const yards = await prisma.yard.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slots: {
        orderBy: [{ row: 'asc' }, { col: 'asc' }],
        select: { id: true, row: true, col: true, zone: true, status: true, machine: { select: { id: true } } },
      },
    },
  });

  const rows: { id: string; yardName: string; row: number; col: number; zone: string | null }[] = [];
  const byYard = yards.map((y) => {
    const free = y.slots.filter((s) => s.status === 'AVAILABLE' && !s.machine);
    for (const s of free) rows.push({ id: s.id, yardName: y.name, row: s.row, col: s.col, zone: s.zone });
    return { yardId: y.id, yardName: y.name, free: free.length, total: y.slots.length };
  });

  return { rows, byYard };
}

export const getDashboardV2 = async (req: Request, res: Response) => {
  try {
    const f = readFilters(req);
    const now = new Date();
    const [yardRows, pendingRows, space] = await Promise.all([inYard(f, now), stage18Pending(f, now), freeSpace()]);

    res.json({
      generatedAt: now.toISOString(),
      cards: {
        inYard: { count: yardRows.length, byModelType: byModelType(yardRows) },
        stage18Pending: { count: pendingRows.length, byModelType: byModelType(pendingRows) },
        freeSpace: {
          count: space.rows.length,
          total: space.byYard.reduce((sum, y) => sum + y.total, 0),
          byYard: space.byYard,
        },
      },
      rows: { inYard: yardRows, stage18Pending: pendingRows, freeSpace: space.rows },
    });
  } catch (error) {
    console.error('getDashboardV2 error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

/** Options for the common filter bar. */
export const getDashboardV2Filters = async (_req: Request, res: Response) => {
  try {
    const [types, ferts, drivers] = await Promise.all([
      prisma.machine.groupBy({
        by: ['machineType'],
        where: { isDemo: false, machineType: { not: null } },
        orderBy: { machineType: 'asc' },
      }),
      prisma.machine.groupBy({
        by: ['itemCode', 'itemDescription'],
        where: { isDemo: false, itemCode: { not: null } },
        orderBy: { itemCode: 'asc' },
      }),
      prisma.driver.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, employeeCode: true },
      }),
    ]);

    // One label per FERT number even if the plant sent two descriptions for it.
    const fertMap = new Map<string, string | null>();
    for (const r of ferts) if (r.itemCode && !fertMap.has(r.itemCode)) fertMap.set(r.itemCode, r.itemDescription);

    res.json({
      machineTypes: types.map((t) => t.machineType).filter((t): t is string => !!t),
      fertNos: [...fertMap.entries()].map(([code, description]) => ({ code, description })),
      drivers,
    });
  } catch (error) {
    console.error('getDashboardV2Filters error:', error);
    res.status(500).json({ error: 'Failed to load dashboard filters' });
  }
};

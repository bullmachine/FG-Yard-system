import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { loadStock } from '../services/yardStockService';
import { notifyEvent } from '../services/notificationService';
import { releaseMachine } from './exitRequestController';
import { getSettings } from '../services/settingsService';

/**
 * Dispatch planning and the PDI dispatch list.
 *
 * The planner asks for a quantity of each model-type. The oldest free machines (FIFO,
 * see yardStockService) are picked when the plan is saved; a plan that asks for more
 * than the free FG yard stock is refused. There is no approval step.
 *
 * Each picked machine is a DispatchItem:
 *   PLANNED -> DRIVER_ASSIGNED (optional, PDI) -> OUT_OF_YARD (FG gate-out)
 *           -> MAIN_GATE_OUT (main gate user, or the main gate system through the API)
 * The planner can cancel an item until it leaves the FG yard.
 */

const IN_YARD = ['PLANNED', 'DRIVER_ASSIGNED'] as const;
const ITEM_STATUSES = ['PLANNED', 'DRIVER_ASSIGNED', 'OUT_OF_YARD', 'MAIN_GATE_OUT', 'CANCELLED'];
// The main gate user only deals with machines that have already left the FG yard.
const MAIN_GATE_STATUSES = ['OUT_OF_YARD', 'MAIN_GATE_OUT'];

const itemInclude = {
  plan: { select: { id: true, planNo: true, createdAt: true, createdBy: { select: { id: true, name: true } } } },
  line: { select: { modelType: true } },
  driver: { select: { id: true, name: true, employeeCode: true, phone: true } },
  mainGateOutBy: { select: { id: true, name: true } },
  machine: {
    select: {
      id: true,
      serialNumber: true,
      barcode: true,
      model: true,
      parkStatus: true,
      currentSlot: { select: { row: true, col: true, yard: { select: { id: true, name: true } } } }
    }
  }
} satisfies Prisma.DispatchItemInclude;

type ItemRow = Prisma.DispatchItemGetPayload<{ include: typeof itemInclude }>;

const planInclude = {
  createdBy: { select: { id: true, name: true } },
  lines: { orderBy: { modelType: 'asc' } },
  items: { include: itemInclude, orderBy: { inwardAt: 'asc' } }
} satisfies Prisma.DispatchPlanInclude;

type PlanRow = Prisma.DispatchPlanGetPayload<{ include: typeof planInclude }>;

function actor(req: Request) {
  return (req as Request & { user?: { id: string; name?: string; email?: string; role?: string } }).user;
}

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function serializeItem(i: ItemRow) {
  return {
    id: i.id,
    status: i.status,
    planId: i.plan.id,
    planNo: i.plan.planNo,
    plannedAt: i.plan.createdAt.toISOString(),
    plannedBy: i.plan.createdBy,
    modelType: i.line.modelType,
    inwardAt: iso(i.inwardAt),
    driver: i.driver,
    driverAssignedAt: iso(i.driverAssignedAt),
    gateOutAt: iso(i.gateOutAt),
    mainGateOutAt: iso(i.mainGateOutAt),
    mainGateOutBy: i.mainGateOutBy,
    mainGateSource: i.mainGateSource,
    mainGateRef: i.mainGateRef,
    cancelledAt: iso(i.cancelledAt),
    machine: {
      id: i.machine.id,
      serialNumber: i.machine.serialNumber,
      barcode: i.machine.barcode,
      model: i.machine.model,
      parkStatus: i.machine.parkStatus,
      yard: i.machine.currentSlot?.yard ?? null,
      row: i.machine.currentSlot?.row ?? null,
      col: i.machine.currentSlot?.col ?? null
    }
  };
}

function serializePlan(p: PlanRow) {
  const items = p.items.map(serializeItem);
  const count = (s: string) => items.filter((i) => i.status === s).length;
  return {
    id: p.id,
    planNo: p.planNo,
    createdAt: p.createdAt.toISOString(),
    createdBy: p.createdBy,
    lines: p.lines.map((l) => ({ id: l.id, modelType: l.modelType, requestedQty: l.requestedQty })),
    totalQty: items.length,
    counts: {
      planned: count('PLANNED') + count('DRIVER_ASSIGNED'),
      outOfYard: count('OUT_OF_YARD'),
      mainGateOut: count('MAIN_GATE_OUT'),
      cancelled: count('CANCELLED')
    },
    items
  };
}

/** Release planned machines back to free stock. */
async function cancelItems(itemIds: string[], userId: string) {
  const items = await prisma.dispatchItem.findMany({
    where: { id: { in: itemIds }, status: { in: [...IN_YARD] } },
    select: { id: true, machineId: true }
  });
  if (items.length === 0) return 0;
  await prisma.$transaction([
    prisma.dispatchItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { status: 'CANCELLED', activeMachineId: null, cancelledAt: new Date(), cancelledById: userId }
    }),
    prisma.machine.updateMany({
      where: { id: { in: items.map((i) => i.machineId) }, status: 'RESERVED' },
      data: { status: 'AVAILABLE' }
    })
  ]);
  return items.length;
}

async function nextPlanNo(): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const prefix = `DP-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`;
  const today = await prisma.dispatchPlan.count({ where: { planNo: { startsWith: prefix } } });
  return `${prefix}${String(today + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export const listDispatchPlans = async (req: Request, res: Response) => {
  try {
    const plans = await prisma.dispatchPlan.findMany({ include: planInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json(plans.map(serializePlan));
  } catch (error) {
    console.error('listDispatchPlans error:', error);
    res.status(500).json({ error: 'Failed to load dispatch plans' });
  }
};

/** Body: { lines: [{ modelType, qty }] } */
export const createDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    // Merge repeated model-types so one plan has one line per model-type.
    const qtyByType = new Map<string, number>();
    const rawLines: unknown[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
    for (const l of rawLines) {
      const rawType = (l as { modelType?: unknown })?.modelType;
      const modelType = typeof rawType === 'string' ? rawType.trim() : '';
      const qty = Number((l as { qty?: unknown })?.qty);
      if (!modelType || !Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ error: 'Each line needs a model-type and a whole quantity of at least 1' });
      }
      qtyByType.set(modelType, (qtyByType.get(modelType) ?? 0) + qty);
    }
    if (qtyByType.size === 0) return res.status(400).json({ error: 'Add at least one model-type' });

    // FIFO pick per model-type, refused as a whole if any model-type is short.
    const stock = (await loadStock()).filter((r) => r.available);
    const picks = new Map<string, typeof stock>();
    const short: string[] = [];
    for (const [modelType, qty] of qtyByType) {
      const free = stock.filter((r) => r.modelType === modelType);
      if (free.length < qty) short.push(`${modelType}: asked ${qty}, only ${free.length} free`);
      picks.set(modelType, free);
    }
    if (short.length) {
      return res.status(400).json({ error: `Not enough free stock in the FG yard. ${short.join('; ')}.` });
    }

    let plan: { id: string; planNo: string; lines: { id: string; modelType: string; requestedQty: number }[] } | null = null;
    // Two plans created in the same second can compute the same number; retry.
    for (let attempt = 0; attempt < 3 && !plan; attempt++) {
      try {
        plan = await prisma.dispatchPlan.create({
          data: {
            planNo: await nextPlanNo(),
            createdById: user.id,
            lines: { create: [...qtyByType].map(([modelType, requestedQty]) => ({ modelType, requestedQty })) }
          },
          select: { id: true, planNo: true, lines: { select: { id: true, modelType: true, requestedQty: true } } }
        });
      } catch (error) {
        if (!isUniqueError(error) || attempt === 2) throw error;
      }
    }
    if (!plan) throw new Error('Plan number could not be allocated');

    // Take machines oldest first. If another planner took one in the meantime, move
    // on to the next free one; if the stock then runs out, undo the whole plan.
    const takenIds: string[] = [];
    let complete = true;
    for (const line of plan.lines) {
      let need = line.requestedQty;
      for (const m of picks.get(line.modelType) ?? []) {
        if (need === 0) break;
        try {
          const [item] = await prisma.$transaction([
            prisma.dispatchItem.create({
              data: { planId: plan.id, lineId: line.id, machineId: m.id, activeMachineId: m.id, inwardAt: m.inwardAt },
              select: { id: true }
            }),
            prisma.machine.update({ where: { id: m.id }, data: { status: 'RESERVED' }, select: { id: true } })
          ]);
          takenIds.push(item.id);
          need--;
        } catch (error) {
          if (!isUniqueError(error)) throw error;
        }
      }
      if (need > 0) { complete = false; break; }
    }

    if (!complete) {
      await cancelItems(takenIds, user.id);
      await prisma.dispatchPlan.delete({ where: { id: plan.id } });
      return res.status(409).json({ error: 'Another planner took some of these machines just now. Check the free stock and save again.' });
    }

    const saved = await prisma.dispatchPlan.findUnique({ where: { id: plan.id }, include: planInclude });
    const out = serializePlan(saved!);

    await notifyEvent({
      type: 'DISPATCH_PLANNED',
      severity: 'INFO',
      title: 'Machines planned for dispatch',
      message: `${out.planNo}: ${out.lines.map((l) => `${l.modelType} × ${l.requestedQty}`).join(', ')} by ${user.name || user.email}.`,
      link: 'pdi'
    });

    res.status(201).json(out);
  } catch (error) {
    console.error('createDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to create dispatch plan' });
  }
};

/** Cancel every machine of a plan that is still in the FG yard. */
export const cancelDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const plan = await prisma.dispatchPlan.findUnique({ where: { id: param(req, 'id') }, include: { items: { select: { id: true } } } });
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });

    const cancelled = await cancelItems(plan.items.map((i) => i.id), user.id);
    if (cancelled === 0) return res.status(400).json({ error: 'No machine of this plan is still in the FG yard' });

    const saved = await prisma.dispatchPlan.findUnique({ where: { id: plan.id }, include: planInclude });
    res.json({ cancelled, plan: serializePlan(saved!) });
  } catch (error) {
    console.error('cancelDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to cancel dispatch plan' });
  }
};

export const cancelDispatchItem = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const item = await prisma.dispatchItem.findUnique({ where: { id: param(req, 'itemId') } });
    if (!item) return res.status(404).json({ error: 'Dispatch machine not found' });
    if (!(IN_YARD as readonly string[]).includes(item.status)) {
      return res.status(400).json({ error: 'Only a machine still in the FG yard can be cancelled' });
    }

    await cancelItems([item.id], user.id);
    const saved = await prisma.dispatchItem.findUnique({ where: { id: item.id }, include: itemInclude });
    res.json(serializeItem(saved!));
  } catch (error) {
    console.error('cancelDispatchItem error:', error);
    res.status(500).json({ error: 'Failed to cancel dispatch machine' });
  }
};

// ---------------------------------------------------------------------------
// PDI dispatch list
// ---------------------------------------------------------------------------

/**
 * Query: status=PLANNED,DRIVER_ASSIGNED,... (optional). Newest plans first. Also returns
 * the overdue threshold so the list can colour the hours since FG gate-out.
 */
export const listDispatchItems = async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status.split(',') : [];
    const allowed = actor(req)?.role === 'MAIN_GATE' ? MAIN_GATE_STATUSES : ITEM_STATUSES;
    const requested = raw.filter((s) => allowed.includes(s));
    const statuses = requested.length ? requested : allowed.filter((s) => s !== 'CANCELLED');
    const items = await prisma.dispatchItem.findMany({
      where: { status: { in: statuses as never } },
      include: itemInclude,
      orderBy: [{ createdAt: 'desc' }, { inwardAt: 'asc' }],
      take: 500
    });
    const settings = await getSettings();
    res.json({ alertHours: settings.dispatchAlertHours, items: items.map(serializeItem) });
  } catch (error) {
    console.error('listDispatchItems error:', error);
    res.status(500).json({ error: 'Failed to load dispatch list' });
  }
};

/** Body: { driverId } to assign, { driverId: null } to clear. */
export const assignDispatchDriver = async (req: Request, res: Response) => {
  try {
    const item = await prisma.dispatchItem.findUnique({ where: { id: param(req, 'itemId') } });
    if (!item) return res.status(404).json({ error: 'Dispatch machine not found' });
    if (!(IN_YARD as readonly string[]).includes(item.status)) {
      return res.status(400).json({ error: 'The driver can only be changed while the machine is in the FG yard' });
    }

    const driverId = typeof req.body?.driverId === 'string' && req.body.driverId ? req.body.driverId : null;
    if (driverId && !(await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }))) {
      return res.status(400).json({ error: 'Driver not found' });
    }

    const saved = await prisma.dispatchItem.update({
      where: { id: item.id },
      data: driverId
        ? { driverId, driverAssignedAt: new Date(), status: 'DRIVER_ASSIGNED' }
        : { driverId: null, driverAssignedAt: null, status: 'PLANNED' },
      include: itemInclude
    });
    res.json(serializeItem(saved));
  } catch (error) {
    console.error('assignDispatchDriver error:', error);
    res.status(500).json({ error: 'Failed to assign driver' });
  }
};

/**
 * Mark a machine out of the plant, or undo it. Shared by the main gate user's button
 * and the main gate system's API call.
 */
async function setMainGateOut(
  itemId: string,
  opts: { undo?: boolean; userId?: string | null; source: 'MANUAL' | 'API'; reference?: string | null }
): Promise<{ error: string; status: number } | { item: ItemRow; already: boolean }> {
  const item = await prisma.dispatchItem.findUnique({ where: { id: itemId } });
  if (!item) return { status: 404, error: 'Dispatch machine not found' };

  if (opts.undo) {
    if (item.status !== 'MAIN_GATE_OUT') return { status: 400, error: 'This machine is not marked as main gate out' };
  } else if (item.status === 'MAIN_GATE_OUT') {
    // A repeated call from the main gate system is harmless.
    return { item: (await prisma.dispatchItem.findUnique({ where: { id: item.id }, include: itemInclude }))!, already: true };
  } else if (item.status !== 'OUT_OF_YARD') {
    return { status: 400, error: 'Only a machine that has gone out of the FG gate can be marked main gate out' };
  }

  try {
    const saved = await prisma.dispatchItem.update({
      where: { id: item.id },
      data: opts.undo
        ? { status: 'OUT_OF_YARD', mainGateOutAt: null, mainGateOutById: null, mainGateSource: null, mainGateRef: null, activeMachineId: item.machineId }
        : {
            status: 'MAIN_GATE_OUT',
            mainGateOutAt: new Date(),
            mainGateOutById: opts.userId ?? null,
            mainGateSource: opts.source,
            mainGateRef: opts.reference ?? null,
            activeMachineId: null
          },
      include: itemInclude
    });
    return { item: saved, already: false };
  } catch (error) {
    if (isUniqueError(error)) return { status: 409, error: 'This machine is already on another dispatch plan' };
    throw error;
  }
}

/** Main gate user's button. Body: { undo?: true } */
export const markMainGateOut = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const result = await setMainGateOut(param(req, 'itemId'), { undo: req.body?.undo === true, userId: user.id, source: 'MANUAL' });
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json(serializeItem(result.item));
  } catch (error) {
    console.error('markMainGateOut error:', error);
    res.status(500).json({ error: 'Failed to update main gate-out' });
  }
};

// ---------------------------------------------------------------------------
// Main gate system API (x-api-key header, no user login)
// ---------------------------------------------------------------------------

/** Machines out of the FG yard and waiting for main gate-out, oldest first. */
export const apiPendingMainGate = async (_req: Request, res: Response) => {
  try {
    const items = await prisma.dispatchItem.findMany({ where: { status: 'OUT_OF_YARD' }, include: itemInclude, orderBy: { gateOutAt: 'asc' } });
    res.json(items.map((i) => ({
      serialNumber: i.machine.serialNumber,
      barcode: i.machine.barcode,
      model: i.machine.model,
      modelType: i.line.modelType,
      planNo: i.plan.planNo,
      fgGateOutAt: iso(i.gateOutAt)
    })));
  } catch (error) {
    console.error('apiPendingMainGate error:', error);
    res.status(500).json({ error: 'Failed to load pending machines' });
  }
};

/**
 * Body: { serialNumber } or { barcode }, plus optional { reference } (invoice, gate pass
 * or truck number - stored as given until the main gate team confirms which one).
 */
export const apiMainGateOut = async (req: Request, res: Response) => {
  try {
    const serialNumber = typeof req.body?.serialNumber === 'string' ? req.body.serialNumber.trim() : '';
    const barcode = typeof req.body?.barcode === 'string' ? req.body.barcode.trim() : '';
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 190) || null : null;
    if (!serialNumber && !barcode) return res.status(400).json({ ok: false, error: 'Send serialNumber or barcode' });

    const machine = await prisma.machine.findFirst({
      where: serialNumber ? { serialNumber } : { barcode },
      select: { id: true, serialNumber: true }
    });
    if (!machine) return res.status(404).json({ ok: false, error: 'Machine not found' });

    const item = await prisma.dispatchItem.findFirst({
      where: { machineId: machine.id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });
    if (!item) return res.status(404).json({ ok: false, error: `${machine.serialNumber} is not on a dispatch plan` });

    const result = await setMainGateOut(item.id, { source: 'API', reference });
    if ('error' in result) return res.status(result.status).json({ ok: false, error: result.error });

    console.log(`Main gate API: ${machine.serialNumber} out${reference ? ` (ref ${reference})` : ''}${result.already ? ' - already recorded' : ''}`);
    res.json({
      ok: true,
      alreadyRecorded: result.already,
      serialNumber: machine.serialNumber,
      mainGateOutAt: iso(result.item.mainGateOutAt)
    });
  } catch (error) {
    console.error('apiMainGateOut error:', error);
    res.status(500).json({ ok: false, error: 'Failed to record main gate-out' });
  }
};

// ---------------------------------------------------------------------------
// FG gate
// ---------------------------------------------------------------------------

/** The machine's dispatch item while it waits in the FG yard, if it has one. */
export function findPlannedDispatch(machineId: string) {
  return prisma.dispatchItem.findFirst({
    where: { machineId, status: { in: [...IN_YARD] } },
    select: { id: true, plan: { select: { planNo: true } } }
  });
}

/**
 * Release a planned machine at FG gate-out: free its slot (recorded as a DISPATCH
 * movement), leaving it AT_GATE for the normal gate-out to complete.
 */
export async function releaseForDispatch(machineId: string, planNo: string, actorId: string) {
  return releaseMachine(machineId, 'DISPATCH', actorId, `Dispatch plan ${planNo}`);
}

/** Called after an authorized FG gate-out: the PDI list shows the machine as out. */
export async function markDispatchGateOut(machineId: string) {
  await prisma.dispatchItem.updateMany({
    where: { machineId, status: { in: [...IN_YARD] } },
    data: { status: 'OUT_OF_YARD', gateOutAt: new Date() }
  });
}

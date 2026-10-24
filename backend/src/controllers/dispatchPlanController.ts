import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { loadStock } from '../services/yardStockService';
import { notifyEvent, notifyUser } from '../services/notificationService';

/**
 * Dispatch planning: a planner reserves yard stock against a sales order and the yard
 * manager approves the plan.
 *
 * Machines are reserved oldest-first (FIFO, see yardStockService) when the plan is
 * saved. A line that cannot be filled keeps its shortfall and can be topped up later.
 * The planner may swap a reserved machine for another one of the same model-type, but
 * must give a reason, which is kept on the reservation.
 *
 * The plan can only be changed while it waits for approval. Rejecting or cancelling a
 * plan releases every machine it holds.
 */

const MANAGERS = ['ADMIN', 'YARD_MANAGER'];
const OPEN_STATUSES = ['PENDING_APPROVAL', 'APPROVED'] as const;

const planInclude = {
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lines: {
    orderBy: { modelType: 'asc' },
    include: {
      reservations: {
        where: { status: { in: ['ACTIVE', 'DISPATCHED'] } },
        orderBy: { inwardAt: 'asc' },
        include: {
          machine: {
            select: {
              id: true,
              serialNumber: true,
              model: true,
              parkStatus: true,
              currentSlot: { select: { row: true, col: true, yard: { select: { id: true, name: true } } } }
            }
          }
        }
      }
    }
  }
} satisfies Prisma.DispatchPlanInclude;

type PlanWithLines = Prisma.DispatchPlanGetPayload<{ include: typeof planInclude }>;

function actor(req: Request) {
  return (req as Request & { user?: { id: string; name?: string; email?: string; role?: string } }).user;
}

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function serialize(plan: PlanWithLines) {
  const lines = plan.lines.map((l) => {
    const reservedQty = l.reservations.length;
    return {
      id: l.id,
      modelType: l.modelType,
      requestedQty: l.requestedQty,
      reservedQty,
      shortfall: Math.max(0, l.requestedQty - reservedQty),
      reservations: l.reservations.map((r) => ({
        id: r.id,
        status: r.status,
        isOverride: r.isOverride,
        overrideReason: r.overrideReason,
        inwardAt: r.inwardAt ? r.inwardAt.toISOString() : null,
        machine: {
          id: r.machine.id,
          serialNumber: r.machine.serialNumber,
          model: r.machine.model,
          parkStatus: r.machine.parkStatus,
          yard: r.machine.currentSlot?.yard ?? null,
          row: r.machine.currentSlot?.row ?? null,
          col: r.machine.currentSlot?.col ?? null
        }
      }))
    };
  });
  const requestedQty = lines.reduce((n, l) => n + l.requestedQty, 0);
  const reservedQty = lines.reduce((n, l) => n + l.reservedQty, 0);
  return {
    id: plan.id,
    planNo: plan.planNo,
    salesOrderNo: plan.salesOrderNo,
    customerName: plan.customerName,
    destination: plan.destination,
    plannedDate: plan.plannedDate.toISOString(),
    notes: plan.notes,
    status: plan.status,
    createdBy: plan.createdBy,
    approvedBy: plan.approvedBy,
    approvedAt: plan.approvedAt ? plan.approvedAt.toISOString() : null,
    rejectReason: plan.rejectReason,
    cancelReason: plan.cancelReason,
    createdAt: plan.createdAt.toISOString(),
    requestedQty,
    reservedQty,
    shortfall: Math.max(0, requestedQty - reservedQty),
    lines
  };
}

async function loadPlan(id: string) {
  return prisma.dispatchPlan.findUnique({ where: { id }, include: planInclude });
}

/**
 * Hold one machine for a plan line. Returns false when another plan took the machine
 * first (the unique activeMachineId index refuses the second reservation).
 */
async function reserveMachine(
  planId: string,
  lineId: string,
  machine: { id: string; inwardAt: Date | null },
  override?: string
): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.dispatchReservation.create({
        data: {
          planId,
          lineId,
          machineId: machine.id,
          activeMachineId: machine.id,
          inwardAt: machine.inwardAt,
          isOverride: !!override,
          overrideReason: override ?? null
        }
      }),
      prisma.machine.updateMany({ where: { id: machine.id, status: 'AVAILABLE' }, data: { status: 'RESERVED' } })
    ]);
    return true;
  } catch (error) {
    if (isUniqueError(error)) return false;
    throw error;
  }
}

/** Reserve free machines of the line's model-type, oldest first, up to its quantity. */
async function fillLine(planId: string, line: { id: string; modelType: string; requestedQty: number }) {
  const held = await prisma.dispatchReservation.count({ where: { lineId: line.id, status: 'ACTIVE' } });
  let need = line.requestedQty - held;
  if (need <= 0) return 0;

  const free = (await loadStock({ modelType: line.modelType })).filter((r) => r.available);
  let added = 0;
  for (const m of free) {
    if (need <= 0) break;
    if (await reserveMachine(planId, line.id, m)) { need--; added++; }
  }
  return added;
}

/** Release every machine a plan holds and give back their AVAILABLE status. */
function releaseAll(planId: string) {
  return prisma.dispatchReservation.findMany({ where: { planId, status: 'ACTIVE' }, select: { id: true, machineId: true } })
    .then((held) => prisma.$transaction([
      prisma.dispatchReservation.updateMany({
        where: { planId, status: 'ACTIVE' },
        data: { status: 'RELEASED', activeMachineId: null, releasedAt: new Date() }
      }),
      prisma.machine.updateMany({
        where: { id: { in: held.map((h) => h.machineId) }, status: 'RESERVED' },
        data: { status: 'AVAILABLE' }
      })
    ]));
}

async function nextPlanNo(): Promise<string> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const prefix = `DP-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`;
  const today = await prisma.dispatchPlan.count({ where: { planNo: { startsWith: prefix } } });
  return `${prefix}${String(today + 1).padStart(3, '0')}`;
}

export const listDispatchPlans = async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const plans = await prisma.dispatchPlan.findMany({
      where: status === 'OPEN'
        ? { status: { in: [...OPEN_STATUSES] } }
        : status ? { status: status as never } : {},
      include: planInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 200
    });
    res.json(plans.map(serialize));
  } catch (error) {
    console.error('listDispatchPlans error:', error);
    res.status(500).json({ error: 'Failed to load dispatch plans' });
  }
};

export const getDispatchPlan = async (req: Request, res: Response) => {
  try {
    const plan = await loadPlan(param(req, 'id'));
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    res.json(serialize(plan));
  } catch (error) {
    console.error('getDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to load dispatch plan' });
  }
};

/**
 * Body: { salesOrderNo, customerName, destination?, plannedDate: 'YYYY-MM-DD', notes?,
 *         lines: [{ modelType, qty }] }
 */
export const createDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const salesOrderNo = text(req.body?.salesOrderNo, 50);
    const customerName = text(req.body?.customerName, 120);
    const destination = text(req.body?.destination, 120) || null;
    const notes = text(req.body?.notes, 1000) || null;
    const dateRaw = req.body?.plannedDate;

    if (!salesOrderNo) return res.status(400).json({ error: 'Sales order number is required' });
    if (!customerName) return res.status(400).json({ error: 'Customer / dealer name is required' });
    if (typeof dateRaw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return res.status(400).json({ error: 'Planned dispatch date must be YYYY-MM-DD' });
    }
    // Midday local time, so the stored day does not shift across time zones.
    const plannedDate = new Date(`${dateRaw}T12:00:00`);
    if (Number.isNaN(plannedDate.getTime())) return res.status(400).json({ error: 'Invalid planned dispatch date' });

    // Merge repeated model-types so one plan has one line per model-type.
    const qtyByType = new Map<string, number>();
    const rawLines: unknown[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
    for (const l of rawLines) {
      const modelType = text((l as { modelType?: unknown })?.modelType, 100);
      const qty = Number((l as { qty?: unknown })?.qty);
      if (!modelType || !Number.isInteger(qty) || qty < 1 || qty > 500) {
        return res.status(400).json({ error: 'Each line needs a model-type and a whole quantity from 1 to 500' });
      }
      qtyByType.set(modelType, (qtyByType.get(modelType) ?? 0) + qty);
    }
    if (qtyByType.size === 0) return res.status(400).json({ error: 'Add at least one model-type line' });
    if (qtyByType.size > 20) return res.status(400).json({ error: 'A plan can have at most 20 model-types' });

    // Two plans created in the same second can compute the same number; retry.
    let created: { id: string; planNo: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await prisma.dispatchPlan.create({
          data: {
            planNo: await nextPlanNo(),
            salesOrderNo,
            customerName,
            destination,
            plannedDate,
            notes,
            createdById: user.id,
            lines: { create: [...qtyByType].map(([modelType, requestedQty]) => ({ modelType, requestedQty })) }
          },
          select: { id: true, planNo: true }
        });
      } catch (error) {
        if (!isUniqueError(error) || attempt === 2) throw error;
      }
    }
    if (!created) throw new Error('Plan number could not be allocated');

    const lines = await prisma.dispatchPlanLine.findMany({ where: { planId: created.id } });
    for (const line of lines) await fillLine(created.id, line);

    const plan = (await loadPlan(created.id))!;
    const out = serialize(plan);

    await notifyEvent({
      type: 'DISPATCH_PLAN_SUBMITTED',
      severity: 'INFO',
      title: 'Dispatch plan to approve',
      message: `${out.planNo} for SO ${salesOrderNo} (${customerName}): ${out.reservedQty} of ${out.requestedQty} reserved, by ${user.name || user.email}.`,
      link: 'dispatch'
    });

    res.status(201).json(out);
  } catch (error) {
    console.error('createDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to create dispatch plan' });
  }
};

/** Try again to reserve FIFO stock for every line that is short. */
export const refillDispatchPlan = async (req: Request, res: Response) => {
  try {
    const plan = await loadPlan(param(req, 'id'));
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    if (plan.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Only a plan waiting for approval can be changed' });

    let added = 0;
    for (const line of plan.lines) added += await fillLine(plan.id, line);

    res.json({ added, plan: serialize((await loadPlan(plan.id))!) });
  } catch (error) {
    console.error('refillDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to reserve stock' });
  }
};

/**
 * Replace one reserved machine with another free machine of the same model-type.
 * Body: { machineId, reason }. The reason is required because it breaks FIFO.
 */
export const swapReservation = async (req: Request, res: Response) => {
  try {
    const planId = param(req, 'id');
    const reservationId = param(req, 'reservationId');
    const machineId = text(req.body?.machineId, 64);
    const reason = text(req.body?.reason, 190);
    if (!machineId) return res.status(400).json({ error: 'Choose the machine to reserve instead' });
    if (reason.length < 5) return res.status(400).json({ error: 'Give a reason for choosing a machine out of FIFO order' });

    const plan = await prisma.dispatchPlan.findUnique({ where: { id: planId }, select: { id: true, status: true } });
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    if (plan.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Only a plan waiting for approval can be changed' });

    const current = await prisma.dispatchReservation.findFirst({
      where: { id: reservationId, planId, status: 'ACTIVE' },
      include: { line: true }
    });
    if (!current) return res.status(404).json({ error: 'Reservation not found on this plan' });

    const candidate = (await loadStock({ modelType: current.line.modelType })).find((r) => r.id === machineId);
    if (!candidate) return res.status(400).json({ error: `That machine is not ${current.line.modelType} stock in the yard` });
    if (!candidate.available) return res.status(409).json({ error: `${candidate.serialNumber} is not free (reserved, on an exit request or not verified)` });

    // Reserve the new machine first, so a failure leaves the plan as it was.
    if (!(await reserveMachine(planId, current.lineId, candidate, reason))) {
      return res.status(409).json({ error: `${candidate.serialNumber} was just reserved by another plan` });
    }
    await prisma.$transaction([
      prisma.dispatchReservation.update({
        where: { id: current.id },
        data: { status: 'RELEASED', activeMachineId: null, releasedAt: new Date() }
      }),
      prisma.machine.updateMany({ where: { id: current.machineId, status: 'RESERVED' }, data: { status: 'AVAILABLE' } })
    ]);

    console.log(`Plan ${planId}: ${current.machineId} swapped for ${candidate.serialNumber} by user ${actor(req)?.id} (${reason})`);
    res.json(serialize((await loadPlan(planId))!));
  } catch (error) {
    console.error('swapReservation error:', error);
    res.status(500).json({ error: 'Failed to change the reserved machine' });
  }
};

export const approveDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const plan = await loadPlan(param(req, 'id'));
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    if (plan.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'This plan is not waiting for approval' });
    if (!plan.lines.some((l) => l.reservations.length > 0)) {
      return res.status(400).json({ error: 'No machines are reserved on this plan. Reserve stock first, or reject the plan.' });
    }

    await prisma.dispatchPlan.update({
      where: { id: plan.id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() }
    });

    const out = serialize((await loadPlan(plan.id))!);
    await notifyUser(plan.createdById, {
      type: 'DISPATCH_PLAN_DECIDED',
      severity: 'INFO',
      title: 'Dispatch plan approved',
      message: `${out.planNo} (SO ${out.salesOrderNo}) approved by ${user.name || user.email}${out.shortfall ? `, short by ${out.shortfall}` : ''}.`,
      link: 'dispatch'
    });
    res.json(out);
  } catch (error) {
    console.error('approveDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to approve dispatch plan' });
  }
};

export const rejectDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const reason = text(req.body?.reason, 190);
    if (reason.length < 3) return res.status(400).json({ error: 'Give a reason for rejecting the plan' });

    const plan = await prisma.dispatchPlan.findUnique({ where: { id: param(req, 'id') } });
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    if (plan.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'This plan is not waiting for approval' });

    await releaseAll(plan.id);
    await prisma.dispatchPlan.update({
      where: { id: plan.id },
      data: { status: 'REJECTED', approvedById: user.id, approvedAt: new Date(), rejectReason: reason }
    });

    await notifyUser(plan.createdById, {
      type: 'DISPATCH_PLAN_DECIDED',
      severity: 'WARNING',
      title: 'Dispatch plan rejected',
      message: `${plan.planNo} (SO ${plan.salesOrderNo}) rejected by ${user.name || user.email}: ${reason}`,
      link: 'dispatch'
    });
    res.json(serialize((await loadPlan(plan.id))!));
  } catch (error) {
    console.error('rejectDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to reject dispatch plan' });
  }
};

/**
 * Cancel a plan and release its machines. The planner may cancel a plan that still
 * waits for approval; an approved plan can only be cancelled by a manager.
 */
export const cancelDispatchPlan = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const reason = text(req.body?.reason, 190);
    if (reason.length < 3) return res.status(400).json({ error: 'Give a reason for cancelling the plan' });

    const plan = await prisma.dispatchPlan.findUnique({ where: { id: param(req, 'id') } });
    if (!plan) return res.status(404).json({ error: 'Dispatch plan not found' });
    if (!(OPEN_STATUSES as readonly string[]).includes(plan.status)) {
      return res.status(400).json({ error: 'This plan is already closed' });
    }
    if (plan.status === 'APPROVED' && !MANAGERS.includes(user.role || '')) {
      return res.status(403).json({ error: 'An approved plan can only be cancelled by the yard manager' });
    }

    await releaseAll(plan.id);
    await prisma.dispatchPlan.update({ where: { id: plan.id }, data: { status: 'CANCELLED', cancelReason: reason } });

    if (plan.createdById !== user.id) {
      await notifyUser(plan.createdById, {
        type: 'DISPATCH_PLAN_DECIDED',
        severity: 'WARNING',
        title: 'Dispatch plan cancelled',
        message: `${plan.planNo} (SO ${plan.salesOrderNo}) cancelled by ${user.name || user.email}: ${reason}`,
        link: 'dispatch'
      });
    }
    res.json(serialize((await loadPlan(plan.id))!));
  } catch (error) {
    console.error('cancelDispatchPlan error:', error);
    res.status(500).json({ error: 'Failed to cancel dispatch plan' });
  }
};

import { Request, Response } from 'express';
import { MovementReason } from '@prisma/client';
import prisma from '../lib/prisma';
import { hasPermission } from '../services/roleAccessService';
import { notifyEvent, notifyUser, pushExitRequestsChanged } from '../services/notificationService';

// Reasons a machine may be taken out of the yard. YARD_ENTRY is a parking reason and
// PRODUCTION is upstream, so neither belongs on an exit ticket. INSPECTION covers
// testing runs; the UI labels it "Testing / Inspection".
const EXIT_REASONS = ['DISPATCH', 'INSPECTION', 'REPAIR', 'RELOCATION', 'MAINTENANCE'] as const;
export { EXIT_REASONS };

// Commercial status the machine should take once its release is approved, so the
// inventory views stop showing it as an in-yard machine.
const REASON_STATUS_MAP: Record<string, string> = {
  DISPATCH: 'DISPATCHED',
  INSPECTION: 'UNDER_INSPECTION',
  REPAIR: 'IN_REPAIR'
};

const requestInclude = {
  machine: {
    select: {
      id: true,
      serialNumber: true,
      model: true,
      parkStatus: true,
      status: true,
      currentSlotId: true
    }
  },
  requestedBy: { select: { id: true, name: true, email: true, role: true } },
  approvedBy: { select: { id: true, name: true } }
} as const;

function actor(req: Request) {
  return (req as Request & { user?: { id: string; name?: string; email?: string; role?: string } }).user;
}

function paramId(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Release the machine's slot and mark it AT_GATE: the shared outcome of an approval
 * and of the manager's quick-release shortcut. Creating the approved request row
 * happens at the call site (so the shortcut can stamp an auto-approved ticket),
 * then this function does the physical release work.
 */
export async function releaseMachine(
  machineId: string,
  reason: string,
  actorId: string,
  notes?: string | null
) {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    include: { currentSlot: { include: { yard: true } } }
  });
  if (!machine?.currentSlotId || !machine.currentSlot) return null;

  await prisma.$transaction([
    prisma.machineExitRequest.updateMany({
      where: { machineId, status: 'PENDING' },
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() }
    }),
    prisma.movement.create({
      data: {
        machineId,
        yardId: machine.currentSlot.yardId,
        fromSlotId: machine.currentSlotId,
        toSlotId: null,
        userId: actorId,
        reason: reason as MovementReason,
        notes: notes ?? null
      }
    }),
    prisma.machine.update({
      where: { id: machineId },
      data: {
        currentSlotId: null,
        parkStatus: 'AT_GATE',
        status: (REASON_STATUS_MAP[reason] as never) || machine.status
      }
    }),
    prisma.slot.update({
      where: { id: machine.currentSlotId },
      data: { status: 'AVAILABLE' }
    })
  ]);

  return { serialNumber: machine.serialNumber, currentSlotYardId: machine.currentSlot.yardId };
}

export const createExitRequest = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const { machineId, reason, notes } = req.body;
    if (typeof machineId !== 'string' || machineId === '') {
      return res.status(400).json({ error: 'Machine is required' });
    }
    const exitReason = typeof reason === 'string' ? reason : '';
    if (!(EXIT_REASONS as readonly string[]).includes(exitReason)) {
      return res.status(400).json({ error: 'Unsupported exit reason' });
    }
    if (exitReason === 'DISPATCH') {
      return res.status(400).json({ error: 'Dispatch goes through Dispatch Planning (FIFO and PDI check). Use exit only for testing, repair, relocation or maintenance.' });
    }

    const machine = await prisma.machine.findUnique({ where: { id: machineId } });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    if (!machine.currentSlotId) {
      return res.status(400).json({ error: 'Machine is not parked in a slot' });
    }

    const planned = await prisma.dispatchItem.findFirst({
      where: { machineId, status: { in: ['PLANNED', 'DRIVER_ASSIGNED'] } },
      select: { plan: { select: { planNo: true } } }
    });
    if (planned) {
      return res.status(400).json({ error: `This machine is planned for dispatch (${planned.plan.planNo}). Cancel it from Dispatch Planning first.` });
    }

    const active = await prisma.machineExitRequest.findFirst({
      where: { machineId, status: { in: ['PENDING', 'APPROVED'] } },
      select: { id: true }
    });
    if (active) {
      return res.status(400).json({ error: 'This machine already has a pending or approved exit request' });
    }

    const created = await prisma.machineExitRequest.create({
      data: {
        machineId,
        requestedById: user.id,
        reason: exitReason,
        notes: typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : null
      },
      include: requestInclude
    });

    await notifyEvent({
      type: 'EXIT_REQUEST',
      severity: 'INFO',
      title: 'Exit request to review',
      message: `${machine.serialNumber} - ${exitReason.replace(/_/g, ' ').toLowerCase()} requested by ${user.name || user.email}.`,
      link: 'requests'
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create exit request' });
  }
};

export const listExitRequests = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const rawStatus = req.query.status;
    const requested = typeof rawStatus === 'string' && rawStatus !== '' ? rawStatus.split(',').filter(Boolean) : [];

    // Reviewers (those who may approve) see the whole board. Security, if not a
    // reviewer, sees approved-but-not-yet-driven-out tickets only (awareness queue);
    // completed ones drop off because their status is COMPLETED. Everyone else sees
    // only the tickets they raised.
    const reviewer = await hasPermission(user.role, 'requests.approve');
    const where: Record<string, unknown> =
      !reviewer && user.role === 'SECURITY'
        ? { status: { in: ['APPROVED'] } }
        : {
            ...(requested.length > 0 ? { status: { in: requested } } : {})
          };
    if (!reviewer && user.role !== 'SECURITY') {
      where.requestedById = user.id;
    }

    const requests = await prisma.machineExitRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch exit requests' });
  }
};

export const approveExitRequest = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const id = paramId(req);
    const row = await prisma.machineExitRequest.findUnique({
      where: { id },
      include: {
        machine: { select: { id: true, serialNumber: true, model: true, parkStatus: true, currentSlotId: true } }
      }
    });
    if (!row) return res.status(404).json({ error: 'Exit request not found' });
    if (row.status !== 'PENDING') {
      return res.status(400).json({ error: `Only PENDING requests can be approved (this one is ${row.status})` });
    }
    if (row.requestedById === user.id) {
      return res.status(400).json({ error: 'Requesters cannot approve their own request' });
    }
    if (!row.machine.currentSlotId) {
      return res.status(400).json({ error: 'Machine is not parked - nothing to release' });
    }
    // A dispatch request raised before dispatch planning existed: reject it instead.
    if (row.reason === 'DISPATCH') {
      return res.status(400).json({ error: 'Dispatch goes through Dispatch Planning (FIFO and PDI check). Use exit only for testing, repair, relocation or maintenance. Reject this request.' });
    }

    await releaseMachine(row.machineId, row.reason, user.id, row.notes);

    await notifyUser(row.requestedById, {
      type: 'EXIT_APPROVED',
      severity: 'INFO',
      title: 'Exit request approved',
      message: `${row.machine.serialNumber} is approved to leave for ${row.reason.replace(/_/g, ' ').toLowerCase()}. Drive it to the exit gate with your badge.`,
      link: 'gate'
    });
    await pushExitRequestsChanged('approved', {
      machineId: row.machineId,
      serialNumber: row.machine.serialNumber,
      reason: row.reason
    });

    const updated = await prisma.machineExitRequest.findUnique({ where: { id }, include: requestInclude });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve exit request' });
  }
};

export const rejectExitRequest = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });

    const id = paramId(req);
    const { reason } = req.body;
    const row = await prisma.machineExitRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Exit request not found' });
    if (row.status !== 'PENDING') {
      return res.status(400).json({ error: `Only PENDING requests can be rejected (this one is ${row.status})` });
    }
    if (row.requestedById === user.id) {
      return res.status(400).json({ error: 'Requesters cannot reject their own request' });
    }

    const rejectReason = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : 'No reason given';
    const updated = await prisma.machineExitRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectReason, approvedById: user.id, approvedAt: new Date() },
      include: requestInclude
    });

    await notifyUser(row.requestedById, {
      type: 'EXIT_REJECTED',
      severity: 'WARNING',
      title: 'Exit request rejected',
      message: `${updated.machine.serialNumber} exit for ${row.reason.replace(/_/g, ' ').toLowerCase()} was not approved. ${rejectReason}`,
      link: 'requests'
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject exit request' });
  }
};
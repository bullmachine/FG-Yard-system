import prisma from '../lib/prisma';
import { notifyEvent } from './notificationService';

export type AssignmentErrorCode =
  | 'MACHINE_NOT_FOUND'
  | 'ALREADY_PLANNED'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_AVAILABLE'
  | 'NO_SLOT_ANYWHERE'
  | 'NOT_RESERVABLE'
  | 'ASSIGN_FAILED';

export interface YardAvailability {
  yardId: string;
  yardName: string;
  total: number;
  available: number;
  reserved: number;
  occupied: number;
  /** BLOCKED, MAINTENANCE, DISPATCH_READY, INSPECTION - slots present but not allocatable. */
  other: number;
}

export interface AssignmentResult {
  success: boolean;
  slotId?: string;
  yardId?: string;
  /** Kept for callers that only surface a sentence; prefer errorCode for branching. */
  error?: string;
  errorCode?: AssignmentErrorCode;
  /** Populated on NO_SLOT_ANYWHERE so the caller can say which yards are exhausted. */
  availability?: YardAvailability[];
  /** Set when a machine is refused for want of a slot, so the queue has a start time. */
  waitingSince?: string;
  /** Set when the machine is not a legitimate holder of the slot it is trying to release. */
  releaseBlockedReason?: string;
}

/**
 * Counts per yard for every slot state, in one pass. "Other" is folded rather than
 * itemised because none of those states can be assigned by a driver, so they only
 * matter as a total when explaining why a yard is not fully available.
 */
export async function getYardAvailability(): Promise<YardAvailability[]> {
  const yards = await prisma.yard.findMany({
    select: {
      id: true,
      name: true,
      slots: { select: { status: true } },
    },
    orderBy: { name: 'asc' },
  });

  return yards.map((yard) => {
    let available = 0;
    let reserved = 0;
    let occupied = 0;
    let other = 0;

    for (const slot of yard.slots) {
      if (slot.status === 'AVAILABLE') available++;
      else if (slot.status === 'RESERVED') reserved++;
      else if (slot.status === 'OCCUPIED') occupied++;
      else other++;
    }

    return {
      yardId: yard.id,
      yardName: yard.name,
      total: yard.slots.length,
      available,
      reserved,
      occupied,
      other,
    };
  });
}

/**
 * A single sentence naming every exhausted yard, e.g.
 * "No allocatable slots. All yards are fully reserved: Production Yard A 40/40,
 *  Dispatch Yard B 24/24, Inspection Yard C 15/15."
 *
 * Deliberately says "reserved" rather than "full": a RESERVED slot is a promise to a
 * machine that may not have arrived yet, so the yard can be fully committed while
 * physically empty. Calling that "full" sends operators looking for a machine that
 * is not there.
 */
export function describeExhaustion(availability: YardAvailability[]): string {
  const allocatable = availability.filter((y) => y.available > 0);

  if (allocatable.length === 0) {
    const breakdown = availability.map((y) => `${y.yardName} ${y.reserved + y.occupied}/${y.total}`).join(', ');
    return `No allocatable slots. All yards are fully reserved: ${breakdown}.`;
  }

  const exhausted = availability
    .filter((y) => y.available === 0)
    .map((y) => `${y.yardName} (${y.reserved} reserved, ${y.total} total)`);

  return `No allocatable slots in ${exhausted.join(' or ')}. Free a slot or choose another yard.`;
}

/**
 * Pick the best available slot for a machine without reserving it: the model's
 * preferred yard first, then any yard by row/col order. Shared by the gate-time
 * assignment and the "suggest a slot" read used to pre-fill the gate override.
 */
async function pickSlotForMachine(machine: { id: string; modelMasterId: string | null }) {
  // Get model master to find preferred yard for this vehicle model
  let preferredYardId: string | null = null;

  if (machine.modelMasterId) {
    const modelMaster = await prisma.vehicleModelMaster.findUnique({
      where: { id: machine.modelMasterId },
    });

    if (modelMaster && modelMaster.preferredYardId) {
      preferredYardId = modelMaster.preferredYardId;
    }
  }

  // Try to find a slot in preferred yard first
  if (preferredYardId) {
    const preferredSlot = await prisma.slot.findFirst({
      where: {
        yardId: preferredYardId,
        status: 'AVAILABLE',
      },
      orderBy: [{ row: 'asc' }, { col: 'asc' }],
    });

    if (preferredSlot) return preferredSlot;
  }

  // If no slot in preferred yard, search all yards
  return prisma.slot.findFirst({
    where: {
      status: 'AVAILABLE',
    },
    orderBy: [{ yardId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
  });
}

/**
 * Read-only suggestion: the slot a machine would be assigned right now. Used by the
 * gate screen to pre-fill the slot picker for the operator's manual override.
 */
export async function findSlotForMachine(machineId: string) {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true, modelMasterId: true },
  });
  if (!machine) return null;
  return pickSlotForMachine(machine);
}

/** Every AVAILABLE slot across all yards, for the gate slot-override list. */
export async function listAvailableSlots() {
  return prisma.slot.findMany({
    where: { status: 'AVAILABLE' },
    orderBy: [{ yardId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
    select: { id: true, yardId: true, row: true, col: true, yard: { select: { name: true } } },
  });
}

/**
 * Assign a yard slot to a machine from the pool of AVAILABLE slots.
 *
 * This is the gate-time assignment: a machine only gets a slot once a driver brings
 * it to the gate (or an admin assigns one manually). When nothing is free the machine
 * is stamped with the time it started waiting rather than being left stateless. The
 * stamp is written only on the first refusal and never overwritten, so a machine that
 * is re-checked keeps its original place in the queue instead of jumping to the back.
 */
export async function assignAvailableSlot(
  machineId: string,
  opts: { userId?: string; notes?: string } = {}
): Promise<AssignmentResult> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
  });

  if (!machine) {
    return { success: false, errorCode: 'MACHINE_NOT_FOUND', error: 'Machine not found' };
  }

  if (machine.plannedSlotId) {
    return { success: false, errorCode: 'ALREADY_PLANNED', error: 'Machine already has a planned slot' };
  }

  const slot = await pickSlotForMachine(machine);

  if (slot) {
    return await assignSlot(machineId, slot.id, slot.yardId, opts.userId, opts.notes || 'Slot assigned at gate');
  }

  // Nothing free anywhere. Record the start of this machine's wait, then report which
  // yards are exhausted so the caller can name them rather than shrugging with "full".
  const waitingSince = machine.slotWaitingSince ?? new Date();

  if (!machine.slotWaitingSince) {
    await prisma.machine.update({
      where: { id: machineId },
      data: { slotWaitingSince: waitingSince },
    });
  }

  const availability = await getYardAvailability();

  await notifyEvent({
    type: 'YARD_FULL',
    severity: 'CRITICAL',
    // The bell renders titles only, so the machine has to be in the title to be
    // actionable; the body still carries the detail.
    title: `Yard full - ${machine.serialNumber} has no slot`,
    message: `${describeExhaustion(availability)} ${machine.serialNumber} (${machine.model}) has been waiting for a slot since ${waitingSince.toISOString()}. Create a yard, release an existing reservation, or free a slot from maintenance.`,
    link: 'yards',
  });

  return {
    success: false,
    errorCode: 'NO_SLOT_ANYWHERE',
    error: 'YARD IS FULL',
    availability,
    waitingSince: waitingSince.toISOString(),
  };
}

/**
 * Backwards-compatible alias. Slot assignment no longer fires at stage 13 - it now
 * happens at the gate - but maintenance/verification scripts still import this name.
 */
export const assignLocationAtStage13 = assignAvailableSlot;

/**
 * Manually assign a specific slot to a machine (admin override, or the gate operator
 * choosing a slot from the override list).
 */
export async function assignSlotToMachine(
  machineId: string,
  slotId: string,
  userId?: string,
  notes?: string
): Promise<AssignmentResult> {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
  });

  if (!machine) {
    return { success: false, errorCode: 'MACHINE_NOT_FOUND', error: 'Machine not found' };
  }

  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
  });

  if (!slot) {
    return { success: false, errorCode: 'SLOT_NOT_FOUND', error: 'Slot not found' };
  }

  if (slot.status !== 'AVAILABLE') {
    return { success: false, errorCode: 'SLOT_NOT_AVAILABLE', error: 'Slot is not available' };
  }

  return await assignSlot(machineId, slotId, slot.yardId, userId, notes || 'Manually assigned');
}

/**
 * Internal function to assign a slot.
 *
 * The three writes are one transaction: taken separately, a failure between them can
 * leave a machine pointing at a slot that is still AVAILABLE, which is invisible to
 * the yard grid and lets a second machine be assigned the same physical slot.
 */
async function assignSlot(
  machineId: string,
  slotId: string,
  yardId: string,
  userId?: string,
  notes?: string
): Promise<AssignmentResult> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.machine.update({
        where: { id: machineId },
        data: {
          plannedSlotId: slotId,
          parkStatus: 'PLANNED',
          // Holding a slot means the machine is no longer queued for one.
          slotWaitingSince: null,
        },
      });

      await tx.slot.update({
        where: { id: slotId },
        data: {
          status: 'RESERVED',
          // Stamped here rather than inferred from updatedAt, which moves on any
          // later edit to the slot.
          reservedAt: new Date(),
        },
      });

      await tx.movement.create({
        data: {
          machineId,
          yardId,
          toSlotId: slotId,
          userId: userId || 'system',
          reason: 'PRODUCTION',
          notes: notes || 'Slot assigned',
        },
      });
    });

    return {
      success: true,
      slotId,
      yardId,
    };
  } catch (error) {
    console.error('Error assigning slot:', error);
    return { success: false, errorCode: 'ASSIGN_FAILED', error: `Assignment failed: ${error}` };
  }
}

/**
 * A machine may only give up a reservation while it is still a plan on paper. Once a
 * driver is on the machine, or it has physically parked, the hold is a real
 * instruction to the gate and the yard: pulling it would either strand a truck that is
 * already en route or contradict what a guard verified on site.
 */
const UNRELEASABLE_PARK_STATUSES = [
  'IN_TRANSIT',
  'AT_GATE',
  'PARKED_PENDING',
  'PARKED_REJECTED',
  'PARKED_VERIFIED',
] as const;

/**
 * Give a reserved slot back, then immediately offer it to whoever has waited longest.
 *
 * Two things make this safe to run without a supervisor watching:
 *   - the guard above, which refuses any hold that a driver or guard already depends on
 *   - the queue read and the hand-off, so freed capacity is never idle while 21
 *     machines sit behind it
 *
 * The machine that gives up its slot re-enters the queue stamped with the release time,
 * which puts it behind everyone already waiting. It therefore cannot immediately take
 * back the slot it just freed.
 */
export async function releaseSlotReservation(
  slotId: string,
  reason: string,
  userId: string
): Promise<
  | { success: true; releasedMachine: string; reassignedTo: string | null; slotId: string }
  | { success: false; errorCode: AssignmentErrorCode; error: string; releaseBlockedReason?: string }
> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { plannedFor: true },
  });

  if (!slot) {
    return { success: false, errorCode: 'SLOT_NOT_FOUND', error: 'Slot not found' };
  }

  if (slot.status !== 'RESERVED') {
    return { success: false, errorCode: 'SLOT_NOT_AVAILABLE', error: 'Slot is not reserved' };
  }

  if (!slot.plannedFor) {
    return { success: false, errorCode: 'NOT_RESERVABLE', error: 'Slot has no machine holding it' };
  }

  const holder = slot.plannedFor;

  if (holder.currentSlotId) {
    return {
      success: false,
      errorCode: 'NOT_RESERVABLE',
      error: 'Machine is already parked in a slot',
      releaseBlockedReason: 'PARKED',
    };
  }

  if (holder.driverId) {
    return {
      success: false,
      errorCode: 'NOT_RESERVABLE',
      error: 'A driver is already assigned to this machine',
      releaseBlockedReason: 'DRIVER_ASSIGNED',
    };
  }

  if ((UNRELEASABLE_PARK_STATUSES as readonly string[]).includes(holder.parkStatus)) {
    return {
      success: false,
      errorCode: 'NOT_RESERVABLE',
      error: `Machine is already ${holder.parkStatus} and its hold is no longer a plan`,
      releaseBlockedReason: holder.parkStatus,
    };
  }

  const releasedSerial = holder.serialNumber;
  const now = new Date();

  // Longest wait first. Machines whose stamp is null are excluded rather than treated
  // as oldest: a null means "never refused a slot", which is not the same claim as
  // "waiting since the beginning of time", and admitting them would hand capacity to
  // machines that never asked for it.
  const nextInQueue = await prisma.machine.findFirst({
    where: {
      // A machine only waits for a slot after the gate has refused it (no free slot),
      // so it has passed stage 18 and is READY_TO_MOVE or still PLANNED.
      assemblyStage: { gte: 18 },
      plannedSlotId: null,
      slotWaitingSince: { not: null },
      driverId: null,
      currentSlotId: null,
      parkStatus: { in: ['PLANNED', 'READY_TO_MOVE'] },
    },
    orderBy: [{ slotWaitingSince: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, serialNumber: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.slot.update({
      where: { id: slotId },
      data: { status: 'AVAILABLE', reservedAt: null },
    });

    await tx.machine.update({
      where: { id: holder.id },
      data: { plannedSlotId: null, slotWaitingSince: now },
    });

    // fromSlot/toSlot record where the machine went, which for a release is nowhere.
    // The reason is RELOCATION rather than a new enum value: the machine is being
    // moved off a plan, and the specific cause is preserved in the note.
    await tx.movement.create({
      data: {
        machineId: holder.id,
        yardId: slot.yardId,
        fromSlotId: slotId,
        userId,
        reason: 'RELOCATION',
        notes: `Reservation released before arrival: ${reason}`,
      },
    });

    if (nextInQueue) {
      await tx.machine.update({
        where: { id: nextInQueue.id },
        data: { plannedSlotId: slotId, parkStatus: 'PLANNED', slotWaitingSince: null },
      });

      await tx.slot.update({
        where: { id: slotId },
        data: { status: 'RESERVED', reservedAt: now },
      });

      await tx.movement.create({
        data: {
          machineId: nextInQueue.id,
          yardId: slot.yardId,
          toSlotId: slotId,
          userId,
          reason: 'PRODUCTION',
          notes: 'Assigned from the waiting queue after a reservation was released',
        },
      });
    }
  });

  if (nextInQueue) {
    await notifyEvent({
      type: 'SLOT_REASSIGNED',
      severity: 'INFO',
      title: `Slot reassigned to ${nextInQueue.serialNumber}`,
      message: `The reservation held by ${releasedSerial} was released (${reason}). ${nextInQueue.serialNumber}, the longest-waiting machine, was assigned the freed slot.`,
      link: 'yards',
    });
  } else {
    await notifyEvent({
      type: 'SLOT_RELEASED',
      severity: 'INFO',
      title: `Reservation released from ${releasedSerial}`,
      message: `${releasedSerial} no longer holds its slot in this yard (${reason}). No machine is currently waiting for a slot, so the slot is now free.`,
      link: 'yards',
    });
  }

  return {
    success: true,
    releasedMachine: releasedSerial,
    reassignedTo: nextInQueue?.serialNumber ?? null,
    slotId,
  };
}

/**
 * Machines that are ready to move (stage 18+) and still have no slot. Slots are
 * assigned at the gate now, so these are machines that have been refused at the gate
 * because every yard was committed - the ones the yard is too small for.
 */
export async function getWaitingMachines(limit = 50) {
  return prisma.machine.findMany({
    where: {
      assemblyStage: { gte: 18 },
      plannedSlotId: null,
    },
    orderBy: [{ slotWaitingSince: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      serialNumber: true,
      model: true,
      assemblyStage: true,
      parkStatus: true,
      slotWaitingSince: true,
    },
  });
}

/**
 * Get available slots count
 */
export async function getAvailableSlotsCount(): Promise<number> {
  return prisma.slot.count({
    where: { status: 'AVAILABLE' }
  });
}

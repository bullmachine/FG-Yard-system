"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getYardAvailability = getYardAvailability;
exports.describeExhaustion = describeExhaustion;
exports.assignLocationAtStage13 = assignLocationAtStage13;
exports.assignSlotToMachine = assignSlotToMachine;
exports.releaseSlotReservation = releaseSlotReservation;
exports.getWaitingMachines = getWaitingMachines;
exports.getAvailableSlotsCount = getAvailableSlotsCount;
const prisma_1 = __importDefault(require("../lib/prisma"));
const notificationService_1 = require("./notificationService");
/**
 * Counts per yard for every slot state, in one pass. "Other" is folded rather than
 * itemised because none of those states can be assigned by a driver, so they only
 * matter as a total when explaining why a yard is not fully available.
 */
async function getYardAvailability() {
    const yards = await prisma_1.default.yard.findMany({
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
            if (slot.status === 'AVAILABLE')
                available++;
            else if (slot.status === 'RESERVED')
                reserved++;
            else if (slot.status === 'OCCUPIED')
                occupied++;
            else
                other++;
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
function describeExhaustion(availability) {
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
 * Auto-assign a yard slot when a machine reaches stage 13.
 *
 * When nothing is free the machine is stamped with the time it started waiting rather
 * than being left stateless. The stamp is written only on the first refusal and never
 * overwritten, so a machine that is re-checked on every 2-hourly sync keeps its
 * original place in the queue instead of jumping to the back each time.
 */
async function assignLocationAtStage13(machineId) {
    const machine = await prisma_1.default.machine.findUnique({
        where: { id: machineId },
    });
    if (!machine) {
        return { success: false, errorCode: 'MACHINE_NOT_FOUND', error: 'Machine not found' };
    }
    if (machine.plannedSlotId) {
        return { success: false, errorCode: 'ALREADY_PLANNED', error: 'Machine already has a planned slot' };
    }
    // Get model master to find preferred yard for this vehicle model
    let preferredYardId = null;
    if (machine.modelMasterId) {
        const modelMaster = await prisma_1.default.vehicleModelMaster.findUnique({
            where: { id: machine.modelMasterId },
        });
        if (modelMaster && modelMaster.preferredYardId) {
            preferredYardId = modelMaster.preferredYardId;
        }
    }
    // Try to find a slot in preferred yard first
    if (preferredYardId) {
        const preferredSlot = await prisma_1.default.slot.findFirst({
            where: {
                yardId: preferredYardId,
                status: 'AVAILABLE',
            },
            orderBy: [{ row: 'asc' }, { col: 'asc' }],
        });
        if (preferredSlot) {
            return await assignSlot(machineId, preferredSlot.id, preferredSlot.yardId);
        }
    }
    // If no slot in preferred yard, search all yards
    const anySlot = await prisma_1.default.slot.findFirst({
        where: {
            status: 'AVAILABLE',
        },
        orderBy: [{ yardId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
    });
    if (anySlot) {
        return await assignSlot(machineId, anySlot.id, anySlot.yardId);
    }
    // Nothing free anywhere. Record the start of this machine's wait, then report which
    // yards are exhausted so the caller can name them rather than shrugging with "full".
    const waitingSince = machine.slotWaitingSince ?? new Date();
    if (!machine.slotWaitingSince) {
        await prisma_1.default.machine.update({
            where: { id: machineId },
            data: { slotWaitingSince: waitingSince },
        });
    }
    const availability = await getYardAvailability();
    await (0, notificationService_1.notifyEvent)({
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
 * Manually assign a slot to a machine
 */
async function assignSlotToMachine(machineId, slotId, userId) {
    const machine = await prisma_1.default.machine.findUnique({
        where: { id: machineId },
    });
    if (!machine) {
        return { success: false, errorCode: 'MACHINE_NOT_FOUND', error: 'Machine not found' };
    }
    const slot = await prisma_1.default.slot.findUnique({
        where: { id: slotId },
    });
    if (!slot) {
        return { success: false, errorCode: 'SLOT_NOT_FOUND', error: 'Slot not found' };
    }
    if (slot.status !== 'AVAILABLE') {
        return { success: false, errorCode: 'SLOT_NOT_AVAILABLE', error: 'Slot is not available' };
    }
    return await assignSlot(machineId, slotId, slot.yardId, userId);
}
/**
 * Internal function to assign a slot.
 *
 * The three writes are one transaction: taken separately, a failure between them can
 * leave a machine pointing at a slot that is still AVAILABLE, which is invisible to
 * the yard grid and lets a second machine be assigned the same physical slot.
 */
async function assignSlot(machineId, slotId, yardId, userId, notes) {
    try {
        await prisma_1.default.$transaction(async (tx) => {
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
                    notes: notes || 'Auto-assigned at Stage 13',
                },
            });
        });
        return {
            success: true,
            slotId,
            yardId,
        };
    }
    catch (error) {
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
];
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
async function releaseSlotReservation(slotId, reason, userId) {
    const slot = await prisma_1.default.slot.findUnique({
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
    if (UNRELEASABLE_PARK_STATUSES.includes(holder.parkStatus)) {
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
    const nextInQueue = await prisma_1.default.machine.findFirst({
        where: {
            assemblyStage: { gte: 13 },
            plannedSlotId: null,
            slotWaitingSince: { not: null },
            driverId: null,
            currentSlotId: null,
            parkStatus: 'PLANNED',
        },
        orderBy: [{ slotWaitingSince: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, serialNumber: true },
    });
    await prisma_1.default.$transaction(async (tx) => {
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
        await (0, notificationService_1.notifyEvent)({
            type: 'SLOT_REASSIGNED',
            severity: 'INFO',
            title: `Slot reassigned to ${nextInQueue.serialNumber}`,
            message: `The reservation held by ${releasedSerial} was released (${reason}). ${nextInQueue.serialNumber}, the longest-waiting machine, was assigned the freed slot.`,
            link: 'yards',
        });
    }
    else {
        await (0, notificationService_1.notifyEvent)({
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
 * Machines that have reached the point of needing a slot and still do not have one.
 * These are the ones the yard is too small for.
 */
async function getWaitingMachines(limit = 50) {
    return prisma_1.default.machine.findMany({
        where: {
            assemblyStage: { gte: 13 },
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
async function getAvailableSlotsCount() {
    return prisma_1.default.slot.count({
        where: { status: 'AVAILABLE' }
    });
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignLocationAtStage13 = assignLocationAtStage13;
exports.assignSlotToMachine = assignSlotToMachine;
exports.getAvailableSlotsCount = getAvailableSlotsCount;
exports.getAvailableSlotsByYard = getAvailableSlotsByYard;
const prisma_1 = __importDefault(require("../lib/prisma"));
const notificationService_1 = require("./notificationService");
/**
 * Auto-assign yard slot when machine reaches stage 13
 * Guard Rail 1: Check if any free slot exists, if not return YARD IS FULL
 */
async function assignLocationAtStage13(machineId) {
    const machine = await prisma_1.default.machine.findUnique({
        where: { id: machineId }
    });
    if (!machine) {
        return { success: false, error: 'Machine not found' };
    }
    if (machine.plannedSlotId) {
        return { success: false, error: 'Machine already has a planned slot' };
    }
    // Get model master to find preferred yard for this vehicle model
    let preferredYardId = null;
    if (machine.modelMasterId) {
        const modelMaster = await prisma_1.default.vehicleModelMaster.findUnique({
            where: { id: machine.modelMasterId }
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
                status: 'AVAILABLE'
            },
            orderBy: [{ row: 'asc' }, { col: 'asc' }]
        });
        if (preferredSlot) {
            return await assignSlot(machineId, preferredSlot.id, preferredYardId);
        }
    }
    // If no slot in preferred yard, search all yards
    const anySlot = await prisma_1.default.slot.findFirst({
        where: {
            status: 'AVAILABLE'
        },
        orderBy: [{ yardId: 'asc' }, { row: 'asc' }, { col: 'asc' }]
    });
    if (anySlot) {
        return await assignSlot(machineId, anySlot.id, anySlot.yardId);
    }
    // No free slot anywhere - YARD IS FULL
    await (0, notificationService_1.notifyEvent)({
        type: 'YARD_FULL',
        severity: 'CRITICAL',
        title: 'Yard is full',
        message: `No free slot was available for machine ${machine.serialNumber} (${machine.model}). Create a yard, free a slot, or block a slot from maintenance.`,
        link: 'yards'
    });
    return { success: false, error: 'YARD IS FULL' };
}
/**
 * Manually assign a slot to a machine
 */
async function assignSlotToMachine(machineId, slotId, userId) {
    const machine = await prisma_1.default.machine.findUnique({
        where: { id: machineId }
    });
    if (!machine) {
        return { success: false, error: 'Machine not found' };
    }
    const slot = await prisma_1.default.slot.findUnique({
        where: { id: slotId }
    });
    if (!slot) {
        return { success: false, error: 'Slot not found' };
    }
    if (slot.status !== 'AVAILABLE') {
        return { success: false, error: 'Slot is not available' };
    }
    return await assignSlot(machineId, slotId, slot.yardId, userId);
}
/**
 * Internal function to assign a slot
 */
async function assignSlot(machineId, slotId, yardId, userId) {
    try {
        // Update machine with planned slot
        await prisma_1.default.machine.update({
            where: { id: machineId },
            data: {
                plannedSlotId: slotId,
                parkStatus: 'PLANNED'
            }
        });
        // Update slot status to RESERVED
        await prisma_1.default.slot.update({
            where: { id: slotId },
            data: { status: 'RESERVED' }
        });
        // Create movement record
        await prisma_1.default.movement.create({
            data: {
                machineId,
                yardId,
                toSlotId: slotId,
                userId: userId || 'system',
                reason: 'PRODUCTION',
                notes: 'Auto-assigned at Stage 13'
            }
        });
        return {
            success: true,
            slotId,
            yardId
        };
    }
    catch (error) {
        console.error('Error assigning slot:', error);
        return { success: false, error: `Assignment failed: ${error}` };
    }
}
/**
 * Get available slots count
 */
async function getAvailableSlotsCount() {
    return prisma_1.default.slot.count({
        where: { status: 'AVAILABLE' }
    });
}
/**
 * Get available slots by yard
 */
async function getAvailableSlotsByYard() {
    const yards = await prisma_1.default.yard.findMany({
        include: {
            slots: {
                where: { status: 'AVAILABLE' },
                select: { id: true }
            }
        }
    });
    return yards.map(yard => ({
        yardId: yard.id,
        yardName: yard.name,
        availableSlots: yard.slots.length
    }));
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGateLogs = exports.closeBarrier = exports.authenticateGate = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const notificationService_1 = require("../services/notificationService");
async function rejectGate(reason, context) {
    await (0, notificationService_1.notifyEvent)({
        type: 'GATE_REJECTED',
        severity: 'CRITICAL',
        title: 'Gate authentication rejected',
        message: `${reason}${context.barcode ? ` (barcode ${context.barcode})` : ''}`,
        link: 'gate'
    });
    return { result: 'REJECTED', reason };
}
const authenticateGate = async (req, res) => {
    try {
        const { driverId, barcode, machineId } = req.body;
        const driver = await prisma_1.default.driver.findUnique({ where: { id: driverId } });
        if (!driver)
            return res.json(await rejectGate('Driver not found', { barcode }));
        const machine = await prisma_1.default.machine.findFirst({
            where: { OR: [{ id: machineId }, { barcode }] }
        });
        if (!machine)
            return res.json(await rejectGate('Machine not found', { barcode }));
        if (!machine.plannedSlotId) {
            return res.json(await rejectGate('No assigned slot', { barcode }));
        }
        const slot = await prisma_1.default.slot.findUnique({ where: { id: machine.plannedSlotId } });
        if (!slot || slot.status !== 'RESERVED') {
            return res.json(await rejectGate('ASSIGNED SLOT UNAVAILABLE', { barcode }));
        }
        const actorId = req.user?.id || 'system';
        await prisma_1.default.gateLog.create({
            data: {
                machineId: machine.id,
                driverId: driver.id,
                authMethod: 'FINGERPRINT',
                barcode: barcode || machine.barcode || '',
                result: 'AUTHORIZED',
                barrierOpenedAt: new Date(),
                userId: actorId
            }
        });
        // Taking custody at the gate is the moment this driver becomes responsible
        // for the machine, so driverId is bound here. Without it the machine has no
        // owner for the rest of the lifecycle: the driver's parking confirmation
        // would be rejected as an unassigned machine, and the movement history could
        // not say who actually drove the load.
        await prisma_1.default.machine.update({
            where: { id: machine.id },
            data: { parkStatus: 'IN_TRANSIT', driverId: driver.id }
        });
        res.json({ result: 'AUTHORIZED', machine: { serialNumber: machine.serialNumber, assignedSlot: slot }, barrier: 'OPEN' });
    }
    catch (error) {
        res.status(500).json({ error: 'Gate authentication failed' });
    }
};
exports.authenticateGate = authenticateGate;
const closeBarrier = async (req, res) => {
    try {
        const { gateLogId } = req.body;
        if (gateLogId) {
            await prisma_1.default.gateLog.update({
                where: { id: gateLogId },
                data: { barrierClosedAt: new Date() }
            });
        }
        res.json({ barrier: 'CLOSED' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to close barrier' });
    }
};
exports.closeBarrier = closeBarrier;
const getGateLogs = async (req, res) => {
    try {
        const logs = await prisma_1.default.gateLog.findMany({
            include: { machine: true, driver: true },
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(logs);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch gate logs' });
    }
};
exports.getGateLogs = getGateLogs;

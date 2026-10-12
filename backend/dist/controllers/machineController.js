"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMachineStageHistory = exports.removeMachineFromSlot = exports.confirmMachineParked = exports.allocateMachine = exports.deleteMachine = exports.updateMachine = exports.createMachine = exports.getMachineById = exports.getAllMachines = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const notificationService_1 = require("../services/notificationService");
const getAllMachines = async (req, res) => {
    try {
        const { search, status, parkStatus, includeDemo, mine } = req.query;
        const where = {};
        // Demo rows are hidden unless explicitly requested, so the assembly views
        // show real plant data by default.
        if (includeDemo !== 'true') {
            where.isDemo = false;
        }
        if (search && String(search).trim()) {
            // Match the identifiers an operator would read off a machine tag or scan:
            // serial number, production order number, and barcode. Model is kept so
            // the existing model search keeps working. Order numbers have leading
            // zeros, so these must stay string comparisons.
            const term = String(search).trim();
            where.OR = [
                { serialNumber: { contains: term } },
                { orderNo: { contains: term } },
                { barcode: { contains: term } },
                { model: { contains: term } }
            ];
        }
        if (status) {
            where.status = status;
        }
        // parkStatus is the parking lifecycle, separate from the commercial status
        // above. The security queue and the driver screen filter on this so they
        // never have to download every machine to find the handful they care about.
        if (parkStatus) {
            const values = String(parkStatus)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            if (values.length === 1) {
                where.parkStatus = values[0];
            }
            else if (values.length > 1) {
                where.parkStatus = { in: values };
            }
        }
        // mine=true resolves the caller's own Driver record from the token, so the
        // driver's list cannot be widened by editing the query string. A user with no
        // linked driver gets nothing rather than the whole plant.
        if (mine === 'true') {
            const actorId = req.user?.id;
            if (!actorId) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const driver = await prisma_1.default.driver.findUnique({
                where: { userId: actorId },
                select: { id: true }
            });
            if (!driver)
                return res.json([]);
            where.driverId = driver.id;
        }
        const machines = await prisma_1.default.machine.findMany({
            where,
            include: {
                currentSlot: {
                    include: {
                        yard: true
                    }
                },
                movements: {
                    include: {
                        machine: true,
                        fromSlot: true,
                        toSlot: true,
                        yard: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { timestamp: 'desc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(machines);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch machines' });
    }
};
exports.getAllMachines = getAllMachines;
const getMachineById = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const machine = await prisma_1.default.machine.findUnique({
            where: { id: machineId },
            include: {
                currentSlot: {
                    include: {
                        yard: true
                    }
                },
                movements: {
                    include: {
                        machine: true,
                        fromSlot: true,
                        toSlot: true,
                        yard: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true
                            }
                        }
                    },
                    orderBy: { timestamp: 'desc' }
                }
            }
        });
        if (!machine) {
            return res.status(404).json({ error: 'Machine not found' });
        }
        res.json(machine);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch machine' });
    }
};
exports.getMachineById = getMachineById;
const createMachine = async (req, res) => {
    try {
        const { serialNumber, model, productionDate, status } = req.body;
        const machine = await prisma_1.default.machine.create({
            data: {
                serialNumber,
                model,
                productionDate: new Date(productionDate),
                status: status || 'AVAILABLE'
            }
        });
        res.status(201).json(machine);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create machine' });
    }
};
exports.createMachine = createMachine;
const updateMachine = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const { serialNumber, model, productionDate, status } = req.body;
        const machine = await prisma_1.default.machine.update({
            where: { id: machineId },
            data: {
                serialNumber,
                model,
                productionDate: productionDate ? new Date(productionDate) : undefined,
                status
            }
        });
        res.json(machine);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update machine' });
    }
};
exports.updateMachine = updateMachine;
const deleteMachine = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        await prisma_1.default.machine.delete({
            where: { id: machineId }
        });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete machine' });
    }
};
exports.deleteMachine = deleteMachine;
const allocateMachine = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const { slotId, reason, notes } = req.body;
        // The actor comes from the verified token, never from the request body, so a
        // movement cannot be attributed to another user.
        const actorId = req.user?.id;
        if (!actorId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const slot = await prisma_1.default.slot.findUnique({
            where: { id: slotId },
            include: { machine: true }
        });
        if (!slot) {
            return res.status(404).json({ error: 'Slot not found' });
        }
        if (slot.machine) {
            return res.status(400).json({ error: 'Slot is already occupied' });
        }
        const machine = await prisma_1.default.machine.findUnique({
            where: { id: machineId },
            include: { currentSlot: true }
        });
        if (!machine) {
            return res.status(404).json({ error: 'Machine not found' });
        }
        // Check if machine is already in the target slot. A machine that security
        // rejected is allowed to be re-parked where it already is, otherwise it can
        // never be re-verified without being moved to a different slot first.
        if (machine.currentSlotId === slotId && machine.parkStatus !== 'PARKED_REJECTED') {
            return res.status(400).json({ error: 'Machine is already in this slot' });
        }
        // Create movement record only if moving to a different slot
        await prisma_1.default.movement.create({
            data: {
                machineId,
                yardId: slot.yardId,
                fromSlotId: machine.currentSlotId,
                toSlotId: slotId,
                userId: actorId,
                reason: reason || 'RELOCATION',
                notes
            }
        });
        // Update machine's current slot and send it to the security review queue.
        // PARKED_PENDING is what SecurityVerification filters on, so without this write
        // the security queue is always empty.
        const updatedMachine = await prisma_1.default.machine.update({
            where: { id: machineId },
            data: { currentSlotId: slotId, parkStatus: 'PARKED_PENDING' },
            include: {
                currentSlot: {
                    include: {
                        yard: true
                    }
                }
            }
        });
        await (0, notificationService_1.notifyEvent)({
            type: 'SECURITY_REVIEW',
            severity: 'WARNING',
            title: 'Security review needed',
            message: `${machine.serialNumber} (${machine.model}) was parked in ${slot.row}-${slot.col} and is awaiting verification.`,
            link: 'security'
        });
        // Update slot status
        await prisma_1.default.slot.update({
            where: { id: slotId },
            data: { status: 'OCCUPIED' }
        });
        if (machine.currentSlotId) {
            await prisma_1.default.slot.update({
                where: { id: machine.currentSlotId },
                data: { status: 'AVAILABLE' }
            });
        }
        res.json(updatedMachine);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to allocate machine' });
    }
};
exports.allocateMachine = allocateMachine;
/**
 * Step 5 of the lifecycle: the driver confirms the machine is physically parked in
 * its assigned slot. This is the transition the gate deliberately stops short of,
 * and the only thing that puts a machine into the security verification queue.
 *
 * Guards are strict on purpose. Confirming a machine that is not IN_TRANSIT, or
 * confirming the same machine twice, would either fabricate a parked machine or
 * let one driver vouch for another driver's load.
 */
const confirmMachineParked = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const { slotId, notes } = req.body;
        const actorId = req.user?.id;
        if (!actorId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const machine = await prisma_1.default.machine.findUnique({
            where: { id: machineId },
            include: { currentSlot: true, driver: true }
        });
        if (!machine) {
            return res.status(404).json({ error: 'Machine not found' });
        }
        // Only the driver who was actually assigned the machine may confirm it is
        // parked. Without this, any operator or manager could vouch for another
        // driver's load and the security walk-down would verify a claim that was
        // never made by the person who drove the machine. ADMIN is the one override,
        // for the case where a driver forgot to tap and the yard has to record it;
        // that override is visible in the movement notes.
        const actor = await prisma_1.default.user.findUnique({
            where: { id: actorId },
            select: { id: true, role: true }
        });
        const actorDriver = await prisma_1.default.driver.findUnique({
            where: { userId: actorId },
            select: { id: true, name: true }
        });
        const isAdminOverride = actor?.role === 'ADMIN';
        if (!isAdminOverride) {
            if (!actorDriver) {
                return res.status(403).json({
                    error: 'Your login is not linked to a driver record, so you cannot confirm parking'
                });
            }
            if (!machine.driverId) {
                return res.status(409).json({
                    error: 'No driver is assigned to this machine. Ask the yard office to assign one first.'
                });
            }
            if (machine.driverId !== actorDriver.id) {
                return res.status(403).json({
                    error: `This machine is assigned to ${machine.driver?.name ?? 'another driver'}, not to you`
                });
            }
        }
        // IN_TRANSIT is the first time a machine may be confirmed parked.
        // PARKED_REJECTED is the re-park after security bounced it.
        if (!['IN_TRANSIT', 'PARKED_REJECTED'].includes(machine.parkStatus)) {
            return res.status(400).json({
                error: `Machine cannot be confirmed parked from status ${machine.parkStatus}. It must be IN_TRANSIT, or PARKED_REJECTED to re-park.`
            });
        }
        const targetSlotId = slotId || machine.plannedSlotId || machine.currentSlotId;
        if (!targetSlotId) {
            return res.status(400).json({ error: 'Machine has no assigned slot to park in' });
        }
        const slot = await prisma_1.default.slot.findUnique({
            where: { id: targetSlotId },
            include: { machine: true, yard: true }
        });
        if (!slot) {
            return res.status(404).json({ error: 'Assigned slot not found' });
        }
        // Someone else may have taken the slot while this machine was in transit.
        if (slot.machine && slot.machine.id !== machine.id) {
            return res.status(409).json({
                error: `ASSIGNED SLOT UNAVAILABLE — ${slot.row}-${slot.col} is now occupied by ${slot.machine.serialNumber}`
            });
        }
        const isRepark = machine.parkStatus === 'PARKED_REJECTED';
        // An admin confirming on a driver's behalf is recorded explicitly, so a later
        // audit can tell a self-confirmed park from a yard-recorded one.
        const overrideNote = isAdminOverride
            ? ` [confirmed by admin on behalf of ${machine.driver?.name ?? 'unassigned driver'}]`
            : '';
        // A re-park is the machine moving back into the slot it already occupies, so
        // there is nothing to record as a movement. The first park is a real move.
        if (!isRepark && machine.currentSlotId !== slot.id) {
            await prisma_1.default.movement.create({
                data: {
                    machineId,
                    yardId: slot.yardId,
                    fromSlotId: machine.currentSlotId,
                    toSlotId: slot.id,
                    userId: actorId,
                    reason: 'YARD_ENTRY',
                    notes: notes ? `${notes}${overrideNote}` : (overrideNote.trim() || null)
                }
            });
        }
        else if (isRepark) {
            await prisma_1.default.movement.create({
                data: {
                    machineId,
                    yardId: slot.yardId,
                    fromSlotId: slot.id,
                    toSlotId: slot.id,
                    userId: actorId,
                    reason: 'YARD_ENTRY',
                    notes: `${notes || 'Re-parked after rejection'}${overrideNote}`
                }
            });
        }
        const updatedMachine = await prisma_1.default.machine.update({
            where: { id: machineId },
            data: { currentSlotId: slot.id, parkStatus: 'PARKED_PENDING' }
        });
        await prisma_1.default.slot.update({
            where: { id: slot.id },
            data: { status: 'OCCUPIED' }
        });
        // Free the slot the machine came from, if it was not the one it just parked in.
        if (machine.currentSlotId && machine.currentSlotId !== slot.id) {
            await prisma_1.default.slot.update({
                where: { id: machine.currentSlotId },
                data: { status: 'AVAILABLE' }
            });
        }
        await (0, notificationService_1.notifyEvent)({
            type: 'SECURITY_REVIEW',
            severity: 'WARNING',
            title: isRepark ? 'Security re-review needed' : 'Security review needed',
            message: `${machine.serialNumber} (${machine.model}) was ${isRepark ? 're-parked' : 'parked'} in ${slot.row}-${slot.col} and is awaiting verification.`,
            link: 'security'
        });
        await (0, notificationService_1.pushSecurityQueueChanged)(isRepark ? 'reparked' : 'parked', {
            machineId: machine.id,
            serialNumber: machine.serialNumber,
            slotLabel: `${slot.row}-${slot.col}`
        });
        res.json({
            ...updatedMachine,
            slotLabel: `${slot.row}-${slot.col}`,
            isRepark,
            adminOverride: isAdminOverride
        });
    }
    catch (error) {
        console.error('Failed to confirm machine parked:', error);
        res.status(500).json({ error: 'Failed to confirm machine parked' });
    }
};
exports.confirmMachineParked = confirmMachineParked;
const removeMachineFromSlot = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const { reason, notes } = req.body;
        const actorId = req.user?.id;
        if (!actorId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const machine = await prisma_1.default.machine.findUnique({
            where: { id: machineId },
            include: { currentSlot: true }
        });
        if (!machine) {
            return res.status(404).json({ error: 'Machine not found' });
        }
        if (!machine.currentSlotId) {
            return res.status(400).json({ error: 'Machine is not in any slot' });
        }
        const currentSlot = await prisma_1.default.slot.findUnique({
            where: { id: machine.currentSlotId }
        });
        // Create movement record for exit
        await prisma_1.default.movement.create({
            data: {
                machineId,
                yardId: currentSlot?.yardId || '',
                fromSlotId: machine.currentSlotId,
                toSlotId: null,
                userId: actorId,
                reason: reason || 'DISPATCH',
                notes
            }
        });
        // Update machine's current slot to null
        const updatedMachine = await prisma_1.default.machine.update({
            where: { id: machineId },
            data: { currentSlotId: null }
        });
        // Update previous slot status to AVAILABLE
        await prisma_1.default.slot.update({
            where: { id: machine.currentSlotId },
            data: { status: 'AVAILABLE' }
        });
        res.json(updatedMachine);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to remove machine from slot' });
    }
};
exports.removeMachineFromSlot = removeMachineFromSlot;
const DEFAULT_TOTAL_STAGES = 18;
/**
 * Full assembly stage history for one machine.
 *
 * The plant only reports the operations it has seen, so this merges the stored
 * rows with a placeholder for every stage. That way the caller always receives
 * a complete timeline and can distinguish "completed", "in progress" and "not
 * started" without doing the arithmetic client-side.
 */
const getMachineStageHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const machineId = Array.isArray(id) ? id[0] : id;
        const machine = await prisma_1.default.machine.findUnique({
            where: { id: machineId },
            select: {
                id: true,
                serialNumber: true,
                model: true,
                modelType: true,
                barcode: true,
                orderNo: true,
                productionOrderId: true,
                itemCode: true,
                itemDescription: true,
                assemblyStage: true,
                parkStatus: true,
                status: true,
                productionDate: true,
                lastSyncAt: true,
                isDemo: true,
                currentSlot: { select: { row: true, col: true, yard: { select: { name: true } } } }
            }
        });
        if (!machine) {
            return res.status(404).json({ error: 'Machine not found' });
        }
        const rows = await prisma_1.default.machineStageHistory.findMany({
            where: { machineId: machineId },
            orderBy: [{ stage: 'asc' }, { syncedAt: 'desc' }]
        });
        // The unique key allows one PLANT_SYNC and one MANUAL row for the same
        // operation. Prefer what the plant reported, and only fall back to a
        // manual entry for stages the plant has never mentioned.
        const plantByStage = new Map();
        const manualByStage = new Map();
        for (const row of rows) {
            const target = row.source === 'PLANT_SYNC' ? plantByStage : manualByStage;
            if (!target.has(row.stage)) {
                target.set(row.stage, row);
            }
        }
        // The plant currently numbers operations 1-18, but grow the timeline if it
        // ever reports a higher stage so a new operation is never silently hidden.
        const totalStages = Math.max(DEFAULT_TOTAL_STAGES, machine.assemblyStage, ...rows.map((row) => row.stage));
        const stages = Array.from({ length: totalStages }, (_, index) => {
            const stage = index + 1;
            const row = plantByStage.get(stage) ?? manualByStage.get(stage);
            let status;
            if (!row) {
                status = 'NOT_STARTED';
            }
            else if (row.isCompleted) {
                status = 'COMPLETED';
            }
            else {
                status = 'IN_PROGRESS';
            }
            return {
                stage: stage,
                status: status,
                workCenter: row?.workCenter ?? null,
                startedAt: row?.startedAt ?? null,
                endedAt: row?.endedAt ?? null,
                completedQty: row?.completedQty ?? null,
                source: row?.source ?? null,
                syncedAt: row?.syncedAt ?? null,
                durationMinutes: row?.startedAt && row?.endedAt
                    ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60000))
                    : null
            };
        });
        const completedCount = stages.filter((s) => s.status === 'COMPLETED').length;
        const inProgress = stages.find((s) => s.status === 'IN_PROGRESS') ?? null;
        const recordedCount = stages.filter((s) => s.status !== 'NOT_STARTED').length;
        res.json({
            machine: machine,
            summary: {
                totalStages: totalStages,
                completedCount: completedCount,
                recordedCount: recordedCount,
                currentStage: machine.assemblyStage,
                inProgressStage: inProgress ? inProgress.stage : null,
                hasHistory: recordedCount > 0,
                lastRecordedAt: rows.reduce((latest, row) => (!latest || row.syncedAt > latest ? row.syncedAt : latest), null)
            },
            stages: stages
        });
    }
    catch (error) {
        console.error('getMachineStageHistory error:', error);
        res.status(500).json({ error: 'Failed to fetch machine stage history' });
    }
};
exports.getMachineStageHistory = getMachineStageHistory;

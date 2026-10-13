"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectExitRequest = exports.approveExitRequest = exports.listExitRequests = exports.createExitRequest = exports.EXIT_REASONS = void 0;
exports.releaseMachine = releaseMachine;
const prisma_1 = __importDefault(require("../lib/prisma"));
const notificationService_1 = require("../services/notificationService");
// Reasons a machine may be taken out of the yard. YARD_ENTRY is a parking reason and
// PRODUCTION is upstream, so neither belongs on an exit ticket. INSPECTION covers
// testing runs; the UI labels it "Testing / Inspection".
const EXIT_REASONS = ['DISPATCH', 'INSPECTION', 'REPAIR', 'RELOCATION', 'MAINTENANCE'];
exports.EXIT_REASONS = EXIT_REASONS;
// Commercial status the machine should take once its release is approved, so the
// inventory views stop showing it as an in-yard machine.
const REASON_STATUS_MAP = {
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
};
function actor(req) {
    return req.user;
}
function paramId(req) {
    const raw = req.params.id;
    return Array.isArray(raw) ? raw[0] : raw;
}
/**
 * Release the machine's slot and mark it AT_GATE: the shared outcome of an approval
 * and of the manager's quick-release shortcut. Creating the approved request row
 * happens at the call site (so the shortcut can stamp an auto-approved ticket),
 * then this function does the physical release work.
 */
async function releaseMachine(machineId, reason, actorId, notes) {
    const machine = await prisma_1.default.machine.findUnique({
        where: { id: machineId },
        include: { currentSlot: { include: { yard: true } } }
    });
    if (!machine?.currentSlotId || !machine.currentSlot)
        return null;
    await prisma_1.default.$transaction([
        prisma_1.default.machineExitRequest.updateMany({
            where: { machineId, status: 'PENDING' },
            data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date() }
        }),
        prisma_1.default.movement.create({
            data: {
                machineId,
                yardId: machine.currentSlot.yardId,
                fromSlotId: machine.currentSlotId,
                toSlotId: null,
                userId: actorId,
                reason: reason,
                notes: notes ?? null
            }
        }),
        prisma_1.default.machine.update({
            where: { id: machineId },
            data: {
                currentSlotId: null,
                parkStatus: 'AT_GATE',
                status: REASON_STATUS_MAP[reason] || machine.status
            }
        }),
        prisma_1.default.slot.update({
            where: { id: machine.currentSlotId },
            data: { status: 'AVAILABLE' }
        })
    ]);
    return { serialNumber: machine.serialNumber, currentSlotYardId: machine.currentSlot.yardId };
}
const createExitRequest = async (req, res) => {
    try {
        const user = actor(req);
        if (!user?.id)
            return res.status(401).json({ error: 'Authentication required' });
        const { machineId, reason, notes } = req.body;
        if (typeof machineId !== 'string' || machineId === '') {
            return res.status(400).json({ error: 'Machine is required' });
        }
        const exitReason = typeof reason === 'string' ? reason : '';
        if (!EXIT_REASONS.includes(exitReason)) {
            return res.status(400).json({ error: 'Unsupported exit reason' });
        }
        const machine = await prisma_1.default.machine.findUnique({ where: { id: machineId } });
        if (!machine)
            return res.status(404).json({ error: 'Machine not found' });
        if (!machine.currentSlotId) {
            return res.status(400).json({ error: 'Machine is not parked in a slot' });
        }
        const active = await prisma_1.default.machineExitRequest.findFirst({
            where: { machineId, status: { in: ['PENDING', 'APPROVED'] } },
            select: { id: true }
        });
        if (active) {
            return res.status(400).json({ error: 'This machine already has a pending or approved exit request' });
        }
        const created = await prisma_1.default.machineExitRequest.create({
            data: {
                machineId,
                requestedById: user.id,
                reason: exitReason,
                notes: typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : null
            },
            include: requestInclude
        });
        await (0, notificationService_1.notifyEvent)({
            type: 'EXIT_REQUEST',
            severity: 'INFO',
            title: 'Exit request to review',
            message: `${machine.serialNumber} - ${exitReason.replace(/_/g, ' ').toLowerCase()} requested by ${user.name || user.email}.`,
            link: 'requests'
        });
        res.status(201).json(created);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create exit request' });
    }
};
exports.createExitRequest = createExitRequest;
const listExitRequests = async (req, res) => {
    try {
        const user = actor(req);
        if (!user?.id)
            return res.status(401).json({ error: 'Authentication required' });
        const rawStatus = req.query.status;
        const requested = typeof rawStatus === 'string' && rawStatus !== '' ? rawStatus.split(',').filter(Boolean) : [];
        // Security sees approved-but-not-yet-driven-out tickets only (awareness queue).
        // Completed tickets drop off automatically because their status is COMPLETED.
        const where = user.role === 'SECURITY'
            ? { status: { in: ['APPROVED'] } }
            : {
                ...(requested.length > 0 ? { status: { in: requested } } : {})
            };
        // Everyone except reviewers sees their own tickets. Operators, technicians,
        // viewers and drivers only ever see what they raised; managers and admins
        // review the whole board.
        if (['OPERATOR', 'SERVICE_TECHNICIAN', 'VIEW_ONLY', 'DRIVER'].includes(user.role || '')) {
            where.requestedById = user.id;
        }
        const requests = await prisma_1.default.machineExitRequest.findMany({
            where,
            include: requestInclude,
            orderBy: { createdAt: 'desc' },
            take: 200
        });
        res.json(requests);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch exit requests' });
    }
};
exports.listExitRequests = listExitRequests;
const approveExitRequest = async (req, res) => {
    try {
        const user = actor(req);
        if (!user?.id)
            return res.status(401).json({ error: 'Authentication required' });
        const id = paramId(req);
        const row = await prisma_1.default.machineExitRequest.findUnique({
            where: { id },
            include: {
                machine: { select: { id: true, serialNumber: true, model: true, parkStatus: true, currentSlotId: true } }
            }
        });
        if (!row)
            return res.status(404).json({ error: 'Exit request not found' });
        if (row.status !== 'PENDING') {
            return res.status(400).json({ error: `Only PENDING requests can be approved (this one is ${row.status})` });
        }
        if (row.requestedById === user.id) {
            return res.status(400).json({ error: 'Requesters cannot approve their own request' });
        }
        if (!row.machine.currentSlotId) {
            return res.status(400).json({ error: 'Machine is not parked - nothing to release' });
        }
        await releaseMachine(row.machineId, row.reason, user.id, row.notes);
        await (0, notificationService_1.notifyUser)(row.requestedById, {
            type: 'EXIT_APPROVED',
            severity: 'INFO',
            title: 'Exit request approved',
            message: `${row.machine.serialNumber} is approved to leave for ${row.reason.replace(/_/g, ' ').toLowerCase()}. Drive it to the exit gate with your badge.`,
            link: 'gate'
        });
        await (0, notificationService_1.pushExitRequestsChanged)('approved', {
            machineId: row.machineId,
            serialNumber: row.machine.serialNumber,
            reason: row.reason
        });
        const updated = await prisma_1.default.machineExitRequest.findUnique({ where: { id }, include: requestInclude });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to approve exit request' });
    }
};
exports.approveExitRequest = approveExitRequest;
const rejectExitRequest = async (req, res) => {
    try {
        const user = actor(req);
        if (!user?.id)
            return res.status(401).json({ error: 'Authentication required' });
        const id = paramId(req);
        const { reason } = req.body;
        const row = await prisma_1.default.machineExitRequest.findUnique({ where: { id } });
        if (!row)
            return res.status(404).json({ error: 'Exit request not found' });
        if (row.status !== 'PENDING') {
            return res.status(400).json({ error: `Only PENDING requests can be rejected (this one is ${row.status})` });
        }
        if (row.requestedById === user.id) {
            return res.status(400).json({ error: 'Requesters cannot reject their own request' });
        }
        const rejectReason = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : 'No reason given';
        const updated = await prisma_1.default.machineExitRequest.update({
            where: { id },
            data: { status: 'REJECTED', rejectReason, approvedById: user.id, approvedAt: new Date() },
            include: requestInclude
        });
        await (0, notificationService_1.notifyUser)(row.requestedById, {
            type: 'EXIT_REJECTED',
            severity: 'WARNING',
            title: 'Exit request rejected',
            message: `${updated.machine.serialNumber} exit for ${row.reason.replace(/_/g, ' ').toLowerCase()} was not approved. ${rejectReason}`,
            link: 'requests'
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to reject exit request' });
    }
};
exports.rejectExitRequest = rejectExitRequest;

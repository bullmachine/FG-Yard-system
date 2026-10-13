"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVehicleModelMaster = exports.updateVehicleModelMaster = exports.createVehicleModelMaster = exports.getVehicleModelMasterById = exports.getAllVehicleModelMasters = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const materialMasterService_1 = require("../services/materialMasterService");
// The form sends "" when "None" is chosen, which is not a valid foreign key. Normalise
// empty/whitespace to null so the field can be cleared without tripping the FK.
function normalizeYardId(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
/**
 * Validate the review status.
 *
 * Returns the cleaned value, or null when the caller must reject the request. An
 * absent field is not an error here: the create path substitutes PENDING and the
 * update path keeps the stored value, so a body that omits `status` cannot silently
 * reset a row back to unreviewed.
 */
function normalizeStatus(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        return null;
    const cleaned = value.trim().toUpperCase();
    if (cleaned === '')
        return undefined;
    return materialMasterService_1.MODEL_MASTER_STATUSES.includes(cleaned)
        ? cleaned
        : null;
}
function handleYardError(error, res, fallback) {
    if (error?.code === 'P2003') {
        return res.status(400).json({ error: 'Invalid preferred yard' });
    }
    return res.status(500).json({ error: fallback });
}
function invalidStatus(res) {
    return res.status(400).json({ error: `Status must be one of: ${materialMasterService_1.MODEL_MASTER_STATUSES.join(', ')}` });
}
const getAllVehicleModelMasters = async (req, res) => {
    try {
        const masters = await prisma_1.default.vehicleModelMaster.findMany({
            include: {
                preferredYard: true,
                _count: { select: { machines: true } }
            },
            orderBy: [{ type: 'asc' }, { model: 'asc' }]
        });
        res.json(masters);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch vehicle model masters' });
    }
};
exports.getAllVehicleModelMasters = getAllVehicleModelMasters;
const getVehicleModelMasterById = async (req, res) => {
    try {
        const id = String(req.params.id);
        const master = await prisma_1.default.vehicleModelMaster.findUnique({
            where: { id },
            include: { preferredYard: true, machines: true }
        });
        if (!master)
            return res.status(404).json({ error: 'Vehicle model master not found' });
        res.json(master);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch vehicle model master' });
    }
};
exports.getVehicleModelMasterById = getVehicleModelMasterById;
const createVehicleModelMaster = async (req, res) => {
    try {
        const { kmat, model, type, modelType, preferredYardId, status } = req.body;
        if (!kmat || !model || !type) {
            return res.status(400).json({ error: 'KMAT, model and type are required' });
        }
        const parsedStatus = normalizeStatus(status);
        if (parsedStatus === null)
            return invalidStatus(res);
        const master = await prisma_1.default.vehicleModelMaster.create({
            data: {
                kmat,
                model,
                type,
                modelType: (0, materialMasterService_1.buildModelType)(model, type, modelType),
                // A row created here is typed in by a human, but it is still unreviewed until
                // somebody confirms it, so an omitted status lands as PENDING rather than
                // ACTIVE. Only an explicit status changes that.
                status: parsedStatus ?? materialMasterService_1.PENDING_MODEL_STATUS,
                preferredYardId: normalizeYardId(preferredYardId)
            },
            include: { preferredYard: true }
        });
        res.status(201).json(master);
    }
    catch (error) {
        if (error?.code === 'P2002') {
            return res.status(400).json({ error: 'KMAT already exists' });
        }
        handleYardError(error, res, 'Failed to create vehicle model master');
    }
};
exports.createVehicleModelMaster = createVehicleModelMaster;
const updateVehicleModelMaster = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { kmat, model, type, modelType, preferredYardId, status } = req.body;
        const existing = await prisma_1.default.vehicleModelMaster.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: 'Vehicle model master not found' });
        const hasYard = Object.prototype.hasOwnProperty.call(req.body, 'preferredYardId');
        const parsedStatus = normalizeStatus(status);
        if (parsedStatus === null)
            return invalidStatus(res);
        // preferredYardId is written to null when the body sends it empty ("None"); when the
        // body omits it the existing value is kept. Without this the update used to pass ""
        // straight into the FK column, fail with a generic 500 and roll the whole edit back.
        const master = await prisma_1.default.vehicleModelMaster.update({
            where: { id },
            data: {
                kmat: kmat ?? existing.kmat,
                model: model ?? existing.model,
                type: type ?? existing.type,
                modelType: (0, materialMasterService_1.buildModelType)(model ?? existing.model, type ?? existing.type, modelType),
                // Spread last so an omitted or blank status keeps the stored review state
                // instead of resetting an ACTIVE row to PENDING on an unrelated edit.
                ...(parsedStatus === undefined ? {} : { status: parsedStatus }),
                preferredYardId: hasYard ? normalizeYardId(preferredYardId) : existing.preferredYardId
            },
            include: { preferredYard: true }
        });
        res.json(master);
    }
    catch (error) {
        if (error?.code === 'P2002') {
            return res.status(400).json({ error: 'KMAT already exists' });
        }
        handleYardError(error, res, 'Failed to update vehicle model master');
    }
};
exports.updateVehicleModelMaster = updateVehicleModelMaster;
const deleteVehicleModelMaster = async (req, res) => {
    try {
        const id = String(req.params.id);
        await prisma_1.default.vehicleModelMaster.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete vehicle model master' });
    }
};
exports.deleteVehicleModelMaster = deleteVehicleModelMaster;

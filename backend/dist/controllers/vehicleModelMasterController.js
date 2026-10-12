"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVehicleModelMaster = exports.updateVehicleModelMaster = exports.createVehicleModelMaster = exports.getVehicleModelMasterById = exports.getAllVehicleModelMasters = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const materialMasterService_1 = require("../services/materialMasterService");
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
        const { kmat, model, type, modelType, preferredYardId } = req.body;
        if (!kmat || !model || !type) {
            return res.status(400).json({ error: 'KMAT, model and type are required' });
        }
        const master = await prisma_1.default.vehicleModelMaster.create({
            data: {
                kmat,
                model,
                type,
                modelType: (0, materialMasterService_1.buildModelType)(model, type, modelType),
                preferredYardId
            },
            include: { preferredYard: true }
        });
        res.status(201).json(master);
    }
    catch (error) {
        if (error?.code === 'P2002') {
            return res.status(400).json({ error: 'KMAT already exists' });
        }
        res.status(500).json({ error: 'Failed to create vehicle model master' });
    }
};
exports.createVehicleModelMaster = createVehicleModelMaster;
const updateVehicleModelMaster = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { kmat, model, type, modelType, preferredYardId } = req.body;
        const existing = await prisma_1.default.vehicleModelMaster.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: 'Vehicle model master not found' });
        const master = await prisma_1.default.vehicleModelMaster.update({
            where: { id },
            data: {
                kmat: kmat ?? existing.kmat,
                model: model ?? existing.model,
                type: type ?? existing.type,
                modelType: (0, materialMasterService_1.buildModelType)(model ?? existing.model, type ?? existing.type, modelType),
                preferredYardId: preferredYardId !== undefined ? preferredYardId : existing.preferredYardId
            },
            include: { preferredYard: true }
        });
        res.json(master);
    }
    catch (error) {
        if (error?.code === 'P2002') {
            return res.status(400).json({ error: 'KMAT already exists' });
        }
        res.status(500).json({ error: 'Failed to update vehicle model master' });
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

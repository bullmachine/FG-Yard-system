"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMaterialMasterStatusEndpoint = exports.syncMaterialMasters = exports.getAllMaterialMasters = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const materialMasterService_1 = require("../services/materialMasterService");
const scheduler_1 = require("../services/scheduler");
const getAllMaterialMasters = async (req, res) => {
    try {
        const materials = await prisma_1.default.materialMaster.findMany({
            orderBy: { syncedAt: 'desc' }
        });
        res.json(materials);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch material masters' });
    }
};
exports.getAllMaterialMasters = getAllMaterialMasters;
const syncMaterialMasters = async (req, res) => {
    try {
        const { fromDt, toDt } = req.body || {};
        const result = await (0, scheduler_1.triggerMaterialMasterSync)(fromDt, toDt);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to trigger material master sync' });
    }
};
exports.syncMaterialMasters = syncMaterialMasters;
const getMaterialMasterStatusEndpoint = async (req, res) => {
    try {
        const status = await (0, materialMasterService_1.getMaterialMasterStatus)();
        res.json(status);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch material master status' });
    }
};
exports.getMaterialMasterStatusEndpoint = getMaterialMasterStatusEndpoint;

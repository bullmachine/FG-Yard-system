"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFertCategory = exports.updateFertCategory = exports.createFertCategory = exports.getFertCategoryById = exports.getAllFertCategories = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
// The form sends "" when "None" is chosen, which is not a valid foreign key. Normalise
// empty/whitespace to null so the field can be cleared without tripping the FK.
function normalizeYardId(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
function handleYardError(error, res, fallback) {
    if (error?.code === 'P2003') {
        return res.status(400).json({ error: 'Invalid preferred yard' });
    }
    return res.status(500).json({ error: fallback });
}
const getAllFertCategories = async (req, res) => {
    try {
        const categories = await prisma_1.default.fertCategory.findMany({
            include: {
                preferredYard: true,
                _count: { select: { machines: true } }
            },
            orderBy: { priority: 'asc' }
        });
        res.json(categories);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch FERT categories' });
    }
};
exports.getAllFertCategories = getAllFertCategories;
const getFertCategoryById = async (req, res) => {
    try {
        const id = String(req.params.id);
        const category = await prisma_1.default.fertCategory.findUnique({
            where: { id },
            include: { preferredYard: true, machines: true }
        });
        if (!category)
            return res.status(404).json({ error: 'FERT category not found' });
        res.json(category);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch FERT category' });
    }
};
exports.getFertCategoryById = getFertCategoryById;
const createFertCategory = async (req, res) => {
    try {
        const { code, name, priority, preferredYardId } = req.body;
        const category = await prisma_1.default.fertCategory.create({
            data: { code, name, priority: priority || 0, preferredYardId: normalizeYardId(preferredYardId) },
            include: { preferredYard: true }
        });
        res.status(201).json(category);
    }
    catch (error) {
        handleYardError(error, res, 'Failed to create FERT category');
    }
};
exports.createFertCategory = createFertCategory;
const updateFertCategory = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { code, name, priority, preferredYardId } = req.body;
        const hasYard = Object.prototype.hasOwnProperty.call(req.body, 'preferredYardId');
        const existing = await prisma_1.default.fertCategory.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: 'FERT category not found' });
        const category = await prisma_1.default.fertCategory.update({
            where: { id },
            data: {
                code: code ?? existing.code,
                name: name ?? existing.name,
                priority: priority ?? existing.priority,
                preferredYardId: hasYard ? normalizeYardId(preferredYardId) : existing.preferredYardId
            },
            include: { preferredYard: true }
        });
        res.json(category);
    }
    catch (error) {
        handleYardError(error, res, 'Failed to update FERT category');
    }
};
exports.updateFertCategory = updateFertCategory;
const deleteFertCategory = async (req, res) => {
    try {
        const id = String(req.params.id);
        await prisma_1.default.fertCategory.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete FERT category' });
    }
};
exports.deleteFertCategory = deleteFertCategory;

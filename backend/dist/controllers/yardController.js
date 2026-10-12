"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteYard = exports.updateYard = exports.createYard = exports.getYardById = exports.getAllYards = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const getAllYards = async (req, res) => {
    try {
        const yards = await prisma_1.default.yard.findMany({
            include: {
                _count: {
                    select: { slots: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(yards);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch yards' });
    }
};
exports.getAllYards = getAllYards;
const getYardById = async (req, res) => {
    try {
        const { id } = req.params;
        const yardId = Array.isArray(id) ? id[0] : id;
        console.log('Fetching yard with ID:', yardId);
        const yard = await prisma_1.default.yard.findUnique({
            where: { id: yardId },
            include: {
                slots: {
                    include: {
                        machine: true
                    },
                    orderBy: [{ row: 'asc' }, { col: 'asc' }]
                }
            }
        });
        if (!yard) {
            console.log('Yard not found with ID:', yardId);
            return res.status(404).json({ error: 'Yard not found' });
        }
        console.log('Yard fetched successfully:', yard.name);
        res.json(yard);
    }
    catch (error) {
        console.error('Error fetching yard:', error);
        res.status(500).json({ error: 'Failed to fetch yard' });
    }
};
exports.getYardById = getYardById;
const createYard = async (req, res) => {
    try {
        const { name, description, rows, cols } = req.body;
        const yard = await prisma_1.default.yard.create({
            data: {
                name,
                description,
                rows: rows || 10,
                cols: cols || 10
            }
        });
        // Create slots for the yard
        const slots = [];
        for (let row = 1; row <= yard.rows; row++) {
            for (let col = 1; col <= yard.cols; col++) {
                slots.push({
                    yardId: yard.id,
                    row,
                    col,
                    status: 'AVAILABLE'
                });
            }
        }
        await prisma_1.default.slot.createMany({
            data: slots
        });
        res.status(201).json(yard);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create yard' });
    }
};
exports.createYard = createYard;
const updateYard = async (req, res) => {
    try {
        const { id } = req.params;
        const yardId = Array.isArray(id) ? id[0] : id;
        const { name, description, rows, cols } = req.body;
        const yard = await prisma_1.default.yard.update({
            where: { id: yardId },
            data: {
                name,
                description,
                rows,
                cols
            }
        });
        res.json(yard);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update yard' });
    }
};
exports.updateYard = updateYard;
const deleteYard = async (req, res) => {
    try {
        const { id } = req.params;
        const yardId = Array.isArray(id) ? id[0] : id;
        await prisma_1.default.yard.delete({
            where: { id: yardId }
        });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete yard' });
    }
};
exports.deleteYard = deleteYard;

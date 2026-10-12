import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// The form sends "" when "None" is chosen, which is not a valid foreign key. Normalise
// empty/whitespace to null so the field can be cleared without tripping the FK.
function normalizeYardId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function handleYardError(error: unknown, res: Response, fallback: string) {
  if ((error as any)?.code === 'P2003') {
    return res.status(400).json({ error: 'Invalid preferred yard' });
  }
  return res.status(500).json({ error: fallback });
}

export const getAllFertCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.fertCategory.findMany({
      include: {
        preferredYard: true,
        _count: { select: { machines: true } }
      },
      orderBy: { priority: 'asc' }
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch FERT categories' });
  }
};

export const getFertCategoryById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const category = await prisma.fertCategory.findUnique({
      where: { id },
      include: { preferredYard: true, machines: true }
    });
    if (!category) return res.status(404).json({ error: 'FERT category not found' });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch FERT category' });
  }
};

export const createFertCategory = async (req: Request, res: Response) => {
  try {
    const { code, name, priority, preferredYardId } = req.body;
    const category = await prisma.fertCategory.create({
      data: { code, name, priority: priority || 0, preferredYardId: normalizeYardId(preferredYardId) },
      include: { preferredYard: true }
    });
    res.status(201).json(category);
  } catch (error) {
    handleYardError(error, res, 'Failed to create FERT category');
  }
};

export const updateFertCategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { code, name, priority, preferredYardId } = req.body;
    const hasYard = Object.prototype.hasOwnProperty.call(req.body, 'preferredYardId');
    const existing = await prisma.fertCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'FERT category not found' });
    const category = await prisma.fertCategory.update({
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
  } catch (error) {
    handleYardError(error, res, 'Failed to update FERT category');
  }
};

export const deleteFertCategory = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.fertCategory.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete FERT category' });
  }
};

import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import {
  buildModelType,
  MODEL_MASTER_STATUSES,
  PENDING_MODEL_STATUS,
  type ModelMasterStatus
} from '../services/materialMasterService';

// The form sends "" when "None" is chosen, which is not a valid foreign key. Normalise
// empty/whitespace to null so the field can be cleared without tripping the FK.
function normalizeYardId(value: unknown): string | null {
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
function normalizeStatus(value: unknown): ModelMasterStatus | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toUpperCase();
  if (cleaned === '') return undefined;
  return (MODEL_MASTER_STATUSES as readonly string[]).includes(cleaned)
    ? (cleaned as ModelMasterStatus)
    : null;
}

function handleYardError(error: unknown, res: Response, fallback: string) {
  if ((error as any)?.code === 'P2003') {
    return res.status(400).json({ error: 'Invalid preferred yard' });
  }
  return res.status(500).json({ error: fallback });
}

function invalidStatus(res: Response) {
  return res.status(400).json({ error: `Status must be one of: ${MODEL_MASTER_STATUSES.join(', ')}` });
}

export const getAllVehicleModelMasters = async (req: Request, res: Response) => {
  try {
    const masters = await prisma.vehicleModelMaster.findMany({
      include: {
        preferredYard: true,
        _count: { select: { machines: true } }
      },
      orderBy: [{ type: 'asc' }, { model: 'asc' }]
    });
    res.json(masters);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vehicle model masters' });
  }
};

export const getVehicleModelMasterById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const master = await prisma.vehicleModelMaster.findUnique({
      where: { id },
      include: { preferredYard: true, machines: true }
    });
    if (!master) return res.status(404).json({ error: 'Vehicle model master not found' });
    res.json(master);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vehicle model master' });
  }
};

export const createVehicleModelMaster = async (req: Request, res: Response) => {
  try {
    const { kmat, model, type, modelType, preferredYardId, status } = req.body;

    if (!kmat || !model || !type) {
      return res.status(400).json({ error: 'KMAT, model and type are required' });
    }

    const parsedStatus = normalizeStatus(status);
    if (parsedStatus === null) return invalidStatus(res);

    const master = await prisma.vehicleModelMaster.create({
      data: {
        kmat,
        model,
        type,
        modelType: buildModelType(model, type, modelType),
        // A row created here is typed in by a human, but it is still unreviewed until
        // somebody confirms it, so an omitted status lands as PENDING rather than
        // ACTIVE. Only an explicit status changes that.
        status: parsedStatus ?? PENDING_MODEL_STATUS,
        preferredYardId: normalizeYardId(preferredYardId)
      },
      include: { preferredYard: true }
    });
    res.status(201).json(master);
  } catch (error) {
    if ((error as any)?.code === 'P2002') {
      return res.status(400).json({ error: 'KMAT already exists' });
    }
    handleYardError(error, res, 'Failed to create vehicle model master');
  }
};

export const updateVehicleModelMaster = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { kmat, model, type, modelType, preferredYardId, status } = req.body;

    const existing = await prisma.vehicleModelMaster.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Vehicle model master not found' });

    const hasYard = Object.prototype.hasOwnProperty.call(req.body, 'preferredYardId');
    const parsedStatus = normalizeStatus(status);
    if (parsedStatus === null) return invalidStatus(res);

    // preferredYardId is written to null when the body sends it empty ("None"); when the
    // body omits it the existing value is kept. Without this the update used to pass ""
    // straight into the FK column, fail with a generic 500 and roll the whole edit back.
    const master = await prisma.vehicleModelMaster.update({
      where: { id },
      data: {
        kmat: kmat ?? existing.kmat,
        model: model ?? existing.model,
        type: type ?? existing.type,
        modelType: buildModelType(model ?? existing.model, type ?? existing.type, modelType),
        // Spread last so an omitted or blank status keeps the stored review state
        // instead of resetting an ACTIVE row to PENDING on an unrelated edit.
        ...(parsedStatus === undefined ? {} : { status: parsedStatus }),
        preferredYardId: hasYard ? normalizeYardId(preferredYardId) : existing.preferredYardId
      },
      include: { preferredYard: true }
    });
    res.json(master);
  } catch (error) {
    if ((error as any)?.code === 'P2002') {
      return res.status(400).json({ error: 'KMAT already exists' });
    }
    handleYardError(error, res, 'Failed to update vehicle model master');
  }
};

export const deleteVehicleModelMaster = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.vehicleModelMaster.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete vehicle model master' });
  }
};
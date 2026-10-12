import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getMaterialMasterStatus } from '../services/materialMasterService';
import { triggerMaterialMasterSync } from '../services/scheduler';

export const getAllMaterialMasters = async (req: Request, res: Response) => {
  try {
    const materials = await prisma.materialMaster.findMany({
      orderBy: { syncedAt: 'desc' }
    });
    res.json(materials);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch material masters' });
  }
};

export const syncMaterialMasters = async (req: Request, res: Response) => {
  try {
    const { fromDt, toDt } = req.body || {};
    const result = await triggerMaterialMasterSync(fromDt, toDt);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger material master sync' });
  }
};

export const getMaterialMasterStatusEndpoint = async (req: Request, res: Response) => {
  try {
    const status = await getMaterialMasterStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch material master status' });
  }
};
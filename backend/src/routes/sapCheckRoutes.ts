import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';
import { machineSapInfo, runSapCheck, sapCheckReport, sapCheckStatus } from '../services/sapCheckService';

const router = Router();

// The SAP check page: last run, delivery dates covered and the mismatch groups.
router.get('/', auth, requirePermission('page.sap'), async (_req: Request, res: Response) => {
  try {
    res.json(await sapCheckReport());
  } catch (error) {
    console.error('SAP check report failed:', error);
    res.status(500).json({ error: 'Failed to build the SAP check' });
  }
});

// Pull SAP stock and deliveries now.
router.post('/run', auth, requirePermission('sap.sync'), async (_req: Request, res: Response) => {
  const result = await runSapCheck('manual');
  res.status(result.ok ? 200 : 502).json({ ...result, status: await sapCheckStatus() });
});

// SAP stock entry and invoices of one machine, for the machine history window.
router.get('/machine/:serial', auth, requirePermission('page.sap', 'page.machines', 'page.yards'), async (req: Request, res: Response) => {
  try {
    res.json(await machineSapInfo(String(req.params.serial)));
  } catch (error) {
    console.error('SAP machine info failed:', error);
    res.status(500).json({ error: 'Failed to load SAP details' });
  }
});

export default router;

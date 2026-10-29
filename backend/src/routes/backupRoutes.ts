import { Router, Request, Response } from 'express';
import { auth, requireRole } from '../middleware/auth';
import { backupStatus, runBackup } from '../services/backupService';

const router = Router();

// Admin only: where the backups go, the last result and the files in the folder.
router.get('/', auth, requireRole(['ADMIN']), (_req: Request, res: Response) => {
  res.json(backupStatus());
});

// Admin only: take a backup now (for example before an update).
router.post('/run', auth, requireRole(['ADMIN']), async (_req: Request, res: Response) => {
  const result = await runBackup('manual');
  res.status(result.ok ? 200 : 500).json({ ...result, status: backupStatus() });
});

export default router;

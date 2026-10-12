import { Router } from 'express';
import {
  advanceStage,
  assignLocation,
  assignDriver,
  triggerSync,
  getSyncStatusEndpoint,
  getStageStatsEndpoint
} from '../controllers/assemblyController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Assembly stage management
router.post('/:id/advance-stage', auth, requireRole(['ADMIN', 'OPERATOR']), advanceStage);
router.post('/:id/assign-location', auth, requireRole(['ADMIN', 'YARD_MANAGER']), assignLocation);
router.post('/:id/assign-driver', auth, requireRole(['ADMIN', 'YARD_MANAGER']), assignDriver);
// verify-parking is registered once, under /api/machines/:id/verify-parking, in
// machineRoutes. It mutates a machine's park status, so it belongs with the other
// machine transitions rather than duplicated here.

// Sync management
router.post('/sync', auth, requireRole(['ADMIN']), triggerSync);
router.get('/sync/status', auth, requireRole(['ADMIN']), getSyncStatusEndpoint);

// Stage counts are shown on the assembly page, which every role can open, so
// this needs authentication but not an admin role.
router.get('/stage-stats', auth, getStageStatsEndpoint);

export default router;

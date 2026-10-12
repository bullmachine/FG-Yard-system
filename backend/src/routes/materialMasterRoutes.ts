import { Router } from 'express';
import {
  getAllMaterialMasters,
  syncMaterialMasters,
  getMaterialMasterStatusEndpoint
} from '../controllers/materialMasterController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', getAllMaterialMasters);
router.post('/sync', auth, requireRole(['ADMIN', 'YARD_MANAGER']), syncMaterialMasters);
router.get('/sync/status', auth, requireRole(['ADMIN', 'YARD_MANAGER']), getMaterialMasterStatusEndpoint);

export default router;
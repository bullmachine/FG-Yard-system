import { Router } from 'express';
import {
  getAllMaterialMasters,
  syncMaterialMasters,
  getMaterialMasterStatusEndpoint
} from '../controllers/materialMasterController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

router.get('/', auth, getAllMaterialMasters);
router.post('/sync', auth, requirePermission('materials.sync'), syncMaterialMasters);
router.get('/sync/status', auth, requirePermission('materials.sync'), getMaterialMasterStatusEndpoint);

export default router;
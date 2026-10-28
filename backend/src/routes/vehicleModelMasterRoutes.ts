import { Router } from 'express';
import {
  getAllVehicleModelMasters,
  getVehicleModelMasterById,
  createVehicleModelMaster,
  updateVehicleModelMaster,
  deleteVehicleModelMaster
} from '../controllers/vehicleModelMasterController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

router.get('/', getAllVehicleModelMasters);
router.get('/:id', getVehicleModelMasterById);
router.post('/', auth, requirePermission('models.manage'), createVehicleModelMaster);
router.put('/:id', auth, requirePermission('models.manage'), updateVehicleModelMaster);
router.delete('/:id', auth, requirePermission('models.manage'), deleteVehicleModelMaster);

export default router;
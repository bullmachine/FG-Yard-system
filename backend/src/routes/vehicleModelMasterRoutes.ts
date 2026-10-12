import { Router } from 'express';
import {
  getAllVehicleModelMasters,
  getVehicleModelMasterById,
  createVehicleModelMaster,
  updateVehicleModelMaster,
  deleteVehicleModelMaster
} from '../controllers/vehicleModelMasterController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', getAllVehicleModelMasters);
router.get('/:id', getVehicleModelMasterById);
router.post('/', auth, requireRole(['ADMIN', 'YARD_MANAGER']), createVehicleModelMaster);
router.put('/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), updateVehicleModelMaster);
router.delete('/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), deleteVehicleModelMaster);

export default router;
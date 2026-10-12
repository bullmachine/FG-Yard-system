import { Router } from 'express';
import {
  getAllDrivers,
  getDriverById,
  createDriver,
  updateDriver,
  deleteDriver,
  uploadDriverPhoto,
  removeDriverPhoto,
  createDriverAccount,
  removeDriverAccount
} from '../controllers/driverController';
import { auth, requireRole } from '../middleware/auth';
import { driverPhotoUpload } from '../lib/upload';

const router = Router();

router.get('/', getAllDrivers);
router.get('/:id', getDriverById);
router.post('/', auth, requireRole(['ADMIN', 'YARD_MANAGER']), createDriver);
router.put('/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), updateDriver);
router.delete('/:id', auth, requireRole(['ADMIN']), deleteDriver);

// Photo is a separate multipart endpoint rather than part of create/update, so a
// photo can be replaced or cleared on its own and the JSON payloads stay JSON.
// multer runs before the controller, which is why the driver lookup (and the cleanup
// of the just-written file) happens inside it.
router.post('/:id/photo', auth, requireRole(['ADMIN', 'YARD_MANAGER']), driverPhotoUpload, uploadDriverPhoto);
router.delete('/:id/photo', auth, requireRole(['ADMIN', 'YARD_MANAGER']), removeDriverPhoto);

// Creating or removing a driver's login is an account change, so it is
// restricted to ADMIN rather than the broader set allowed to edit drivers.
router.post('/:id/account', auth, requireRole(['ADMIN']), createDriverAccount);
router.delete('/:id/account', auth, requireRole(['ADMIN']), removeDriverAccount);

export default router;

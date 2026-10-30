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
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';
import { driverPhotoUpload } from '../lib/upload';

const router = Router();

// Reads need a signed-in user: the roster holds names, phones and badge codes.
router.get('/', auth, getAllDrivers);
router.get('/:id', auth, getDriverById);
router.post('/', auth, requirePermission('drivers.manage'), createDriver);
router.put('/:id', auth, requirePermission('drivers.manage'), updateDriver);
router.delete('/:id', auth, requirePermission('drivers.admin'), deleteDriver);

// Photo is a separate multipart endpoint rather than part of create/update, so a
// photo can be replaced or cleared on its own and the JSON payloads stay JSON.
// multer runs before the controller, which is why the driver lookup (and the cleanup
// of the just-written file) happens inside it.
router.post('/:id/photo', auth, requirePermission('drivers.manage'), driverPhotoUpload, uploadDriverPhoto);
router.delete('/:id/photo', auth, requirePermission('drivers.manage'), removeDriverPhoto);

// Creating or removing a driver's login is an account change, so it is
// restricted to ADMIN rather than the broader set allowed to edit drivers.
router.post('/:id/account', auth, requirePermission('drivers.admin'), createDriverAccount);
router.delete('/:id/account', auth, requirePermission('drivers.admin'), removeDriverAccount);

export default router;

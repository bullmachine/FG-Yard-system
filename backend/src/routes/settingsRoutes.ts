import { Router } from 'express';
import {
  getSettingsHandler,
  updateSettingsHandler,
  testConnectionHandler
} from '../controllers/settingsController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Integration settings are administrator-only for both reading and writing.
router.get('/', auth, requireRole(['ADMIN']), getSettingsHandler);
router.put('/', auth, requireRole(['ADMIN']), updateSettingsHandler);
router.post('/test', auth, requireRole(['ADMIN']), testConnectionHandler);

export default router;

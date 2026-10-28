import { Router } from 'express';
import {
  getSettingsHandler,
  updateSettingsHandler,
  testConnectionHandler,
  rotateMainGateKeyHandler,
  getStockLoadHandler
} from '../controllers/settingsController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Integration settings are administrator-only for both reading and writing.
// Whether the initial stock load is on; read by Machine Tracking for every role.
router.get('/stock-load', auth, getStockLoadHandler);
router.get('/', auth, requireRole(['ADMIN']), getSettingsHandler);
router.put('/', auth, requireRole(['ADMIN']), updateSettingsHandler);
router.post('/test', auth, requireRole(['ADMIN']), testConnectionHandler);
router.post('/main-gate-key', auth, requireRole(['ADMIN']), rotateMainGateKeyHandler);

export default router;

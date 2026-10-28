import { Router } from 'express';
import { getMovements } from '../controllers/movementController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// Every role that can open the History screen. SECURITY is included because the
// verification log is read alongside the movements it produced.
router.get('/', auth, requirePermission('page.history'), getMovements);

export default router;

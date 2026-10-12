import { Router } from 'express';
import { getMovements } from '../controllers/movementController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Every role that can open the History screen. SECURITY is included because the
// verification log is read alongside the movements it produced.
router.get('/', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SECURITY']), getMovements);

export default router;

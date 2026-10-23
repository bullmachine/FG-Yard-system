import { Router } from 'express';
import { authenticateGate, closeBarrier, getGateLogs, getBarrierConfig, getGateSlots } from '../controllers/gateController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

router.post('/authenticate', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), authenticateGate);
router.post('/barrier/close', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), closeBarrier);
router.get('/logs', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'SECURITY']), getGateLogs);
// The gate tab needs the barrier endpoints even for operators/security, so this
// route keeps the same audience as the gate screen it serves.
router.get('/barrier/config', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SECURITY']), getBarrierConfig);
// Slot options for the gate's manual override. Same audience as the gate screen.
router.get('/slots', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), getGateSlots);

export default router;

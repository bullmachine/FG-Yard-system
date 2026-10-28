import { Router } from 'express';
import { authenticateGate, closeBarrier, getGateLogs, getBarrierConfig, getGateSlots } from '../controllers/gateController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

router.post('/authenticate', auth, requirePermission('page.gate'), authenticateGate);
router.post('/barrier/close', auth, requirePermission('page.gate'), closeBarrier);
router.get('/logs', auth, requirePermission('gate.logs'), getGateLogs);
// The gate tab needs the barrier endpoints even for operators/security, so this
// route keeps the same audience as the gate screen it serves.
router.get('/barrier/config', auth, requirePermission('page.gate'), getBarrierConfig);
// Slot options for the gate's manual override. Same audience as the gate screen.
router.get('/slots', auth, requirePermission('page.gate'), getGateSlots);

export default router;

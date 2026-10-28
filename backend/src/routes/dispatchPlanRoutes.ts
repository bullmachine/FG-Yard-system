import { Router } from 'express';
import {
  listDispatchPlans,
  getDispatchPlan,
  createDispatchPlan,
  cancelDispatchPlan,
  cancelDispatchItem,
  listDispatchItems,
  assignDispatchDriver,
  recordPdiCheck,
  markMainGateOut
} from '../controllers/dispatchPlanController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// The planning team plans and cancels, the PDI team assigns drivers, and the main gate
// marks machines out of the plant.

// Dispatch list. Declared before /:id so "items" is not read as a plan id.
router.get('/items', auth, requirePermission('page.pdi', 'page.dispatch'), listDispatchItems);
router.put('/items/:itemId/driver', auth, requirePermission('pdi.assign'), assignDispatchDriver);
router.post('/items/:itemId/pdi', auth, requirePermission('pdi.check'), recordPdiCheck);
router.post('/items/:itemId/main-gate-out', auth, requirePermission('pdi.mainGate'), markMainGateOut);
router.post('/items/:itemId/cancel', auth, requirePermission('dispatch.plan'), cancelDispatchItem);

router.get('/', auth, requirePermission('page.dispatch'), listDispatchPlans);
router.get('/:id', auth, requirePermission('page.dispatch'), getDispatchPlan);
router.post('/', auth, requirePermission('dispatch.plan'), createDispatchPlan);
router.post('/:id/cancel', auth, requirePermission('dispatch.plan'), cancelDispatchPlan);

export default router;

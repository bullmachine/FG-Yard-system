import { Router } from 'express';
import {
  listDispatchPlans,
  createDispatchPlan,
  cancelDispatchPlan,
  cancelDispatchItem,
  listDispatchItems,
  assignDispatchDriver,
  markMainGateOut
} from '../controllers/dispatchPlanController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// The planning team plans and cancels, the PDI team assigns drivers, and the main gate
// marks machines out of the plant.
const PLANNERS = ['ADMIN', 'YARD_MANAGER', 'PLANNER'];
const PDI_TEAM = ['ADMIN', 'YARD_MANAGER', 'PDI'];
const MAIN_GATE = ['ADMIN', 'YARD_MANAGER', 'MAIN_GATE'];
const VIEWERS = ['ADMIN', 'YARD_MANAGER', 'PLANNER', 'PDI', 'MAIN_GATE', 'OPERATOR', 'VIEW_ONLY'];

// Dispatch list. Declared before /:id so "items" is not read as a plan id.
router.get('/items', auth, requireRole(VIEWERS), listDispatchItems);
router.put('/items/:itemId/driver', auth, requireRole(PDI_TEAM), assignDispatchDriver);
router.post('/items/:itemId/main-gate-out', auth, requireRole(MAIN_GATE), markMainGateOut);
router.post('/items/:itemId/cancel', auth, requireRole(PLANNERS), cancelDispatchItem);

router.get('/', auth, requireRole(VIEWERS.filter((r) => r !== 'MAIN_GATE')), listDispatchPlans);
router.post('/', auth, requireRole(PLANNERS), createDispatchPlan);
router.post('/:id/cancel', auth, requireRole(PLANNERS), cancelDispatchPlan);

export default router;

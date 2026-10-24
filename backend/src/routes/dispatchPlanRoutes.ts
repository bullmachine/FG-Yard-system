import { Router } from 'express';
import {
  listDispatchPlans,
  getDispatchPlan,
  createDispatchPlan,
  refillDispatchPlan,
  swapReservation,
  approveDispatchPlan,
  rejectDispatchPlan,
  cancelDispatchPlan
} from '../controllers/dispatchPlanController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// The planning team raises and edits plans; the yard manager approves them.
const VIEWERS = ['ADMIN', 'YARD_MANAGER', 'PLANNER', 'OPERATOR', 'VIEW_ONLY'];
const PLANNERS = ['ADMIN', 'YARD_MANAGER', 'PLANNER'];
const APPROVERS = ['ADMIN', 'YARD_MANAGER'];

router.get('/', auth, requireRole(VIEWERS), listDispatchPlans);
router.get('/:id', auth, requireRole(VIEWERS), getDispatchPlan);
router.post('/', auth, requireRole(PLANNERS), createDispatchPlan);
router.post('/:id/refill', auth, requireRole(PLANNERS), refillDispatchPlan);
router.post('/:id/reservations/:reservationId/swap', auth, requireRole(PLANNERS), swapReservation);
router.post('/:id/cancel', auth, requireRole(PLANNERS), cancelDispatchPlan);
router.post('/:id/approve', auth, requireRole(APPROVERS), approveDispatchPlan);
router.post('/:id/reject', auth, requireRole(APPROVERS), rejectDispatchPlan);

export default router;

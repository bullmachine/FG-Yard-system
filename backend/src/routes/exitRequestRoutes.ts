import { Router } from 'express';
import {
  createExitRequest,
  listExitRequests,
  approveExitRequest,
  rejectExitRequest
} from '../controllers/exitRequestController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// Any signed-in user can raise an exit ticket; only managers decide. Managers can
// still use the quick-release shortcut on the yard for an instant dispatch.
router.post('/', auth, createExitRequest);
router.get('/', auth, listExitRequests);

// Review: YARD_MANAGER and ADMIN decide.
router.post('/:id/approve', auth, requirePermission('requests.approve'), approveExitRequest);
router.post('/:id/reject', auth, requirePermission('requests.approve'), rejectExitRequest);

export default router;
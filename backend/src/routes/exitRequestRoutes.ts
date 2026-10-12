import { Router } from 'express';
import {
  createExitRequest,
  listExitRequests,
  approveExitRequest,
  rejectExitRequest
} from '../controllers/exitRequestController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Any signed-in user can raise an exit ticket; only managers decide. Managers can
// still use the quick-release shortcut on the yard for an instant dispatch.
router.post('/', auth, createExitRequest);
router.get('/', auth, listExitRequests);

// Review: YARD_MANAGER and ADMIN decide.
router.post('/:id/approve', auth, requireRole(['ADMIN', 'YARD_MANAGER']), approveExitRequest);
router.post('/:id/reject', auth, requireRole(['ADMIN', 'YARD_MANAGER']), rejectExitRequest);

export default router;
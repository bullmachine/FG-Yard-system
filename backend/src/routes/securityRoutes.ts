import { Router } from 'express';
import { getSecurityVerifications } from '../controllers/securityController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// The audit trail of parking verifications. ADMIN and SECURITY can act on the
// queue, so they can read its history; YARD_MANAGER gets read-only visibility.
router.get(
  '/verifications',
  auth,
  requirePermission('page.security', 'history.verifications'),
  getSecurityVerifications
);

export default router;

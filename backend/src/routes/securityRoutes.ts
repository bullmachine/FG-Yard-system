import { Router } from 'express';
import { getSecurityVerifications } from '../controllers/securityController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// The audit trail of parking verifications. ADMIN and SECURITY can act on the
// queue, so they can read its history; YARD_MANAGER gets read-only visibility.
router.get(
  '/verifications',
  auth,
  requireRole(['ADMIN', 'SECURITY', 'YARD_MANAGER']),
  getSecurityVerifications
);

export default router;

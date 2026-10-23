import { Router } from 'express';
import { getDashboardV2, getDashboardV2Filters } from '../controllers/dashboardV2Controller';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// The new dashboard is under development alongside the current one, so only the
// roles reviewing it can open it. Widen this when it goes live as the main dashboard.
const REVIEWERS = ['ADMIN', 'YARD_MANAGER'];

router.get('/', auth, requireRole(REVIEWERS), getDashboardV2);
router.get('/filters', auth, requireRole(REVIEWERS), getDashboardV2Filters);

export default router;

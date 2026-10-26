import { Router } from 'express';
import { getFgDashboard } from '../controllers/dashboardController';
import { auth } from '../middleware/auth';

const router = Router();

// Yard-level counts only, so every signed-in role that has the dashboard can read it.
router.get('/', auth, getFgDashboard);

export default router;

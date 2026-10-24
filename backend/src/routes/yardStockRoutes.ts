import { Router } from 'express';
import { getYardStock, setInwardDate } from '../controllers/yardStockController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Read: everyone who can see the yard. Edit the inward date: yard managers only.
router.get('/', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'PLANNER', 'OPERATOR', 'VIEW_ONLY']), getYardStock);
router.put('/:machineId/inward-date', auth, requireRole(['ADMIN', 'YARD_MANAGER']), setInwardDate);

export default router;

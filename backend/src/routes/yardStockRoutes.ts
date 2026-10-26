import { Router } from 'express';
import { getYardStock, setInwardDate, clearReturnHold } from '../controllers/yardStockController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Read: everyone who can see the yard. Edit the inward date: yard managers only.
router.get('/', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'PLANNER', 'OPERATOR', 'VIEW_ONLY']), getYardStock);
router.put('/:machineId/inward-date', auth, requireRole(['ADMIN', 'YARD_MANAGER']), setInwardDate);
router.post('/:machineId/clear-hold', auth, requireRole(['ADMIN', 'YARD_MANAGER']), clearReturnHold);

export default router;

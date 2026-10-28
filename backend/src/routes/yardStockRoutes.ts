import { Router } from 'express';
import { getYardStock, setInwardDate, clearReturnHold } from '../controllers/yardStockController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// Read: everyone who can see the yard. Edit the inward date: yard managers only.
router.get('/', auth, requirePermission('page.stock', 'dispatch.plan'), getYardStock);
router.put('/:machineId/inward-date', auth, requirePermission('stock.edit'), setInwardDate);
router.post('/:machineId/clear-hold', auth, requirePermission('stock.edit'), clearReturnHold);

export default router;

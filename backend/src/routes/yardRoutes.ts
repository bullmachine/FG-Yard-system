import { Router } from 'express';
import {
  getAllYards,
  getYardById,
  createYard,
  updateYard,
  deleteYard,
  getYardAvailability,
  releaseSlotReservation,
  blockSlot,
  unblockSlot
} from '../controllers/yardController';
import { auth } from '../middleware/auth';
import { requirePermission } from '../services/roleAccessService';

const router = Router();

// Public routes (read-only)
router.get('/', getAllYards);
// Registered before /:id so "availability" is not swallowed as a yard id.
router.get('/availability', getYardAvailability);
router.get('/:id', getYardById);

// Protected routes (require authentication)
router.post('/', auth, requirePermission('yards.edit'), createYard);
router.put('/:id', auth, requirePermission('yards.edit'), updateYard);
router.delete('/:id', auth, requirePermission('yards.delete'), deleteYard);
// Releasing a reservation is a capacity decision: managers only.
router.post('/slots/:id/release', auth, requirePermission('yards.edit'), releaseSlotReservation);
router.post('/slots/:id/block', auth, requirePermission('yards.edit'), blockSlot);
router.post('/slots/:id/unblock', auth, requirePermission('yards.edit'), unblockSlot);

export default router;

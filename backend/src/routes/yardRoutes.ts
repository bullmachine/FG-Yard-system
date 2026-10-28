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
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Public routes (read-only)
router.get('/', getAllYards);
// Registered before /:id so "availability" is not swallowed as a yard id.
router.get('/availability', getYardAvailability);
router.get('/:id', getYardById);

// Protected routes (require authentication)
router.post('/', auth, requireRole(['ADMIN', 'YARD_MANAGER']), createYard);
router.put('/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), updateYard);
router.delete('/:id', auth, requireRole(['ADMIN']), deleteYard);
// Releasing a reservation is a capacity decision: managers only.
router.post('/slots/:id/release', auth, requireRole(['ADMIN', 'YARD_MANAGER']), releaseSlotReservation);
router.post('/slots/:id/block', auth, requireRole(['ADMIN', 'YARD_MANAGER']), blockSlot);
router.post('/slots/:id/unblock', auth, requireRole(['ADMIN', 'YARD_MANAGER']), unblockSlot);

export default router;

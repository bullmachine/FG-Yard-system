import { Router } from 'express';
import {
  getAllYards,
  getYardById,
  createYard,
  updateYard,
  deleteYard,
  getYardAvailability,
  removeSlot,
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
// Removing one slot: managers may take a slot out of service, but permanently deleting
// an unused one is an ADMIN action, enforced inside the handler. Declared before /:id
// so the specific shape wins regardless of registration order.
router.delete('/slots/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), removeSlot);

export default router;

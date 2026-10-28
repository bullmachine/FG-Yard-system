import { Router } from 'express';
import {
  getAllMachines,
  getMachineById,
  getReturnMachines,
  reserveReturnSlot,
  getMachineStageHistory,
  createMachine,
  updateMachine,
  deleteMachine,
  allocateMachine,
  removeMachineFromSlot,
  confirmMachineParked
} from '../controllers/machineController';
import {
  advanceStage,
  assignLocation,
  assignDriver,
  verifyParking
} from '../controllers/assemblyController';
import { auth, requireRole, optionalAuth } from '../middleware/auth';

const router = Router();

// Public routes (read-only). optionalAuth lets ?mine=true resolve the caller's
// own driver record from a token, while other callers keep the existing
// unauthenticated read behaviour.
router.get('/', optionalAuth, getAllMachines);
// Returns must be declared before GET /:id, which would otherwise treat "returns"
// as a machine id.
router.get('/returns', auth, getReturnMachines);
router.get('/:id', getMachineById);

// Protected routes (require authentication)
router.get('/:id/history', auth, getMachineStageHistory);
router.post('/', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), createMachine);
router.put('/:id', auth, requireRole(['ADMIN', 'YARD_MANAGER']), updateMachine);
router.delete('/:id', auth, requireRole(['ADMIN']), deleteMachine);
router.post('/:id/allocate', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), allocateMachine);
router.post('/:id/remove', auth, requireRole(['ADMIN', 'YARD_MANAGER']), removeMachineFromSlot);
// Reserve a slot for a machine coming back to the yard, so the gate-in checkpoint
// will admit it. Managers and the operator plan returns; everyone else reads.
router.post('/:id/return-slot', auth, requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), reserveReturnSlot);

// Driver confirms the machine is physically parked in its slot. This is the step
// that creates the security verification queue entry. Ownership of the machine
// is enforced in the controller, so the role gate here is only the outer
// boundary: a logged-in user of an allowed role still has to be the assigned
// driver, unless they are an ADMIN, YARD_MANAGER, OPERATOR or SECURITY (the guard at
// the FG gate) recording it on the driver's behalf, which is written into the notes.
router.post(
  '/:id/parked',
  auth,
  requireRole(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SECURITY', 'DRIVER']),
  confirmMachineParked
);

// Assembly stage management
router.post('/:id/advance-stage', auth, requireRole(['ADMIN', 'OPERATOR']), advanceStage);
router.post('/:id/assign-location', auth, requireRole(['ADMIN', 'YARD_MANAGER']), assignLocation);
router.post('/:id/assign-driver', auth, requireRole(['ADMIN', 'YARD_MANAGER']), assignDriver);
router.post('/:id/verify-parking', auth, requireRole(['ADMIN', 'SECURITY']), verifyParking);

export default router;

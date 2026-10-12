"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const machineController_1 = require("../controllers/machineController");
const assemblyController_1 = require("../controllers/assemblyController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Public routes (read-only). optionalAuth lets ?mine=true resolve the caller's
// own driver record from a token, while other callers keep the existing
// unauthenticated read behaviour.
router.get('/', auth_1.optionalAuth, machineController_1.getAllMachines);
router.get('/:id', machineController_1.getMachineById);
// Protected routes (require authentication)
router.get('/:id/history', auth_1.auth, machineController_1.getMachineStageHistory);
router.post('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), machineController_1.createMachine);
router.put('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), machineController_1.updateMachine);
router.delete('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), machineController_1.deleteMachine);
router.post('/:id/allocate', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), machineController_1.allocateMachine);
router.post('/:id/remove', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), machineController_1.removeMachineFromSlot);
// Driver confirms the machine is physically parked in its slot. This is the step
// that creates the security verification queue entry. Ownership of the machine
// is enforced in the controller, so the role gate here is only the outer
// boundary: a logged-in user of an allowed role still has to be the assigned
// driver (or an ADMIN, who may record it on the driver's behalf).
router.post('/:id/parked', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'DRIVER']), machineController_1.confirmMachineParked);
// Assembly stage management
router.post('/:id/advance-stage', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'OPERATOR']), assemblyController_1.advanceStage);
router.post('/:id/assign-location', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), assemblyController_1.assignLocation);
router.post('/:id/assign-driver', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), assemblyController_1.assignDriver);
router.post('/:id/verify-parking', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'SECURITY']), assemblyController_1.verifyParking);
exports.default = router;

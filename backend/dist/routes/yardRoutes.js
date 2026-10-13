"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const yardController_1 = require("../controllers/yardController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Public routes (read-only)
router.get('/', yardController_1.getAllYards);
// Registered before /:id so "availability" is not swallowed as a yard id.
router.get('/availability', yardController_1.getYardAvailability);
router.get('/:id', yardController_1.getYardById);
// Protected routes (require authentication)
router.post('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.createYard);
router.put('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.updateYard);
router.delete('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), yardController_1.deleteYard);
// Releasing a reservation is a capacity decision: managers only.
router.post('/slots/:id/release', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.releaseSlotReservation);
// Removing one slot: managers may take a slot out of service, but permanently deleting
// an unused one is an ADMIN action, enforced inside the handler. Declared before /:id
// so the specific shape wins regardless of registration order.
router.delete('/slots/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.removeSlot);
exports.default = router;

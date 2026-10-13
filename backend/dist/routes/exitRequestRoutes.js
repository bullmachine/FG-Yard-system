"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const exitRequestController_1 = require("../controllers/exitRequestController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Any signed-in user can raise an exit ticket; only managers decide. Managers can
// still use the quick-release shortcut on the yard for an instant dispatch.
router.post('/', auth_1.auth, exitRequestController_1.createExitRequest);
router.get('/', auth_1.auth, exitRequestController_1.listExitRequests);
// Review: YARD_MANAGER and ADMIN decide.
router.post('/:id/approve', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), exitRequestController_1.approveExitRequest);
router.post('/:id/reject', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), exitRequestController_1.rejectExitRequest);
exports.default = router;

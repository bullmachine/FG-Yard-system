"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const assemblyController_1 = require("../controllers/assemblyController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Assembly stage management
router.post('/:id/advance-stage', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'OPERATOR']), assemblyController_1.advanceStage);
router.post('/:id/assign-location', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), assemblyController_1.assignLocation);
router.post('/:id/assign-driver', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), assemblyController_1.assignDriver);
// verify-parking is registered once, under /api/machines/:id/verify-parking, in
// machineRoutes. It mutates a machine's park status, so it belongs with the other
// machine transitions rather than duplicated here.
// Sync management
router.post('/sync', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), assemblyController_1.triggerSync);
router.get('/sync/status', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), assemblyController_1.getSyncStatusEndpoint);
// Stage counts are shown on the assembly page, which every role can open, so
// this needs authentication but not an admin role.
router.get('/stage-stats', auth_1.auth, assemblyController_1.getStageStatsEndpoint);
exports.default = router;

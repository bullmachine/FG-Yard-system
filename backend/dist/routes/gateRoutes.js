"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gateController_1 = require("../controllers/gateController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post('/authenticate', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), gateController_1.authenticateGate);
router.post('/barrier/close', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR']), gateController_1.closeBarrier);
router.get('/logs', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'SECURITY']), gateController_1.getGateLogs);
// The gate tab needs the barrier endpoints even for operators/security, so this
// route keeps the same audience as the gate screen it serves.
router.get('/barrier/config', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SECURITY']), gateController_1.getBarrierConfig);
exports.default = router;

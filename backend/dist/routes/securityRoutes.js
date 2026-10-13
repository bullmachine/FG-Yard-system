"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const securityController_1 = require("../controllers/securityController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// The audit trail of parking verifications. ADMIN and SECURITY can act on the
// queue, so they can read its history; YARD_MANAGER gets read-only visibility.
router.get('/verifications', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'SECURITY', 'YARD_MANAGER']), securityController_1.getSecurityVerifications);
exports.default = router;

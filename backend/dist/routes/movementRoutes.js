"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const movementController_1 = require("../controllers/movementController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Every role that can open the History screen. SECURITY is included because the
// verification log is read alongside the movements it produced.
router.get('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SECURITY']), movementController_1.getMovements);
exports.default = router;

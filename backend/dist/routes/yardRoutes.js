"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const yardController_1 = require("../controllers/yardController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Public routes (read-only)
router.get('/', yardController_1.getAllYards);
router.get('/:id', yardController_1.getYardById);
// Protected routes (require authentication)
router.post('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.createYard);
router.put('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), yardController_1.updateYard);
router.delete('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), yardController_1.deleteYard);
exports.default = router;

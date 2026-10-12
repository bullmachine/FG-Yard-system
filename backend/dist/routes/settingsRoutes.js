"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const settingsController_1 = require("../controllers/settingsController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Integration settings are administrator-only for both reading and writing.
router.get('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), settingsController_1.getSettingsHandler);
router.put('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), settingsController_1.updateSettingsHandler);
router.post('/test', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), settingsController_1.testConnectionHandler);
exports.default = router;

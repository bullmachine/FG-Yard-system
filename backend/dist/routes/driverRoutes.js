"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const driverController_1 = require("../controllers/driverController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', driverController_1.getAllDrivers);
router.get('/:id', driverController_1.getDriverById);
router.post('/', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), driverController_1.createDriver);
router.put('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN', 'YARD_MANAGER']), driverController_1.updateDriver);
router.delete('/:id', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), driverController_1.deleteDriver);
// Creating or removing a driver's login is an account change, so it is
// restricted to ADMIN rather than the broader set allowed to edit drivers.
router.post('/:id/account', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), driverController_1.createDriverAccount);
router.delete('/:id/account', auth_1.auth, (0, auth_1.requireRole)(['ADMIN']), driverController_1.removeDriverAccount);
exports.default = router;

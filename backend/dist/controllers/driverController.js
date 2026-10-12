"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDriverAccount = exports.createDriverAccount = exports.deleteDriver = exports.updateDriver = exports.createDriver = exports.getDriverById = exports.getAllDrivers = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const getAllDrivers = async (req, res) => {
    try {
        const drivers = await prisma_1.default.driver.findMany({
            include: {
                _count: { select: { machines: true } },
                user: { select: { id: true, name: true, email: true, isActive: true } }
            },
            orderBy: { name: 'asc' }
        });
        res.json(drivers);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch drivers' });
    }
};
exports.getAllDrivers = getAllDrivers;
const getDriverById = async (req, res) => {
    try {
        const id = String(req.params.id);
        const driver = await prisma_1.default.driver.findUnique({
            where: { id },
            include: { machines: true }
        });
        if (!driver)
            return res.status(404).json({ error: 'Driver not found' });
        res.json(driver);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch driver' });
    }
};
exports.getDriverById = getDriverById;
const createDriver = async (req, res) => {
    try {
        const { name, phone, licenseNo, biometricId } = req.body;
        const driver = await prisma_1.default.driver.create({
            data: { name, phone, licenseNo, biometricId }
        });
        res.status(201).json(driver);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create driver' });
    }
};
exports.createDriver = createDriver;
const updateDriver = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, phone, licenseNo, biometricId, status } = req.body;
        const driver = await prisma_1.default.driver.update({
            where: { id },
            data: { name, phone, licenseNo, biometricId, status }
        });
        res.json(driver);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update driver' });
    }
};
exports.updateDriver = updateDriver;
const deleteDriver = async (req, res) => {
    try {
        const id = String(req.params.id);
        await prisma_1.default.driver.delete({ where: { id } });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete driver' });
    }
};
exports.deleteDriver = deleteDriver;
/**
 * Give a driver a login so they can confirm parking and receive the security
 * outcome. Without a linked account a driver is a name on a gate log: they can
 * be checked in at the gate but cannot see the rejection that follows.
 *
 * The account is always created with the DRIVER role, and the email must not
 * already be in use, so this cannot be used to take over an existing admin
 * account. Re-linking an already linked driver is rejected rather than silently
 * moving the link.
 */
const createDriverAccount = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const driver = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!driver)
            return res.status(404).json({ error: 'Driver not found' });
        if (driver.userId) {
            return res.status(400).json({ error: 'This driver already has a login' });
        }
        const existing = await prisma_1.default.user.findUnique({ where: { email: String(email).toLowerCase() } });
        if (existing) {
            return res.status(400).json({ error: 'A user with that email already exists' });
        }
        const hashed = await (0, auth_1.hashPassword)(String(password));
        const user = await prisma_1.default.user.create({
            data: {
                email: String(email).toLowerCase(),
                password: hashed,
                name: name || driver.name,
                role: 'DRIVER'
            },
            select: { id: true, name: true, email: true, role: true }
        });
        const updated = await prisma_1.default.driver.update({
            where: { id },
            data: { userId: user.id },
            include: { user: { select: { id: true, name: true, email: true, isActive: true } } }
        });
        res.status(201).json(updated);
    }
    catch (error) {
        console.error('Failed to create driver account:', error);
        res.status(500).json({ error: 'Failed to create driver login' });
    }
};
exports.createDriverAccount = createDriverAccount;
/**
 * Remove the login link and deactivate the account, rather than deleting the
 * user: their past verifications and notifications reference that row.
 */
const removeDriverAccount = async (req, res) => {
    try {
        const id = String(req.params.id);
        const driver = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!driver)
            return res.status(404).json({ error: 'Driver not found' });
        if (!driver.userId)
            return res.status(400).json({ error: 'This driver has no login' });
        await prisma_1.default.$transaction([
            prisma_1.default.user.update({ where: { id: driver.userId }, data: { isActive: false } }),
            prisma_1.default.driver.update({ where: { id }, data: { userId: null } })
        ]);
        res.json({ ...driver, userId: null });
    }
    catch (error) {
        console.error('Failed to remove driver account:', error);
        res.status(500).json({ error: 'Failed to remove driver login' });
    }
};
exports.removeDriverAccount = removeDriverAccount;

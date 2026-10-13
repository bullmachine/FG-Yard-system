"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDriverAccount = exports.createDriverAccount = exports.deleteDriver = exports.removeDriverPhoto = exports.uploadDriverPhoto = exports.updateDriver = exports.createDriver = exports.getDriverById = exports.getAllDrivers = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const upload_1 = require("../lib/upload");
// Employee codes are badge values, so they stay short and are never allowed to be
// blank-as-null after being typed. Anything longer than this would also be pointless
// and would only surface as a raw MySQL truncation error.
const MAX_EMPLOYEE_CODE_LENGTH = 64;
/**
 * Normalise an optional free-text field.
 *
 * `undefined` means "the caller omitted it" (leave the stored value alone on update),
 * while an empty string collapses to `null` (the caller is clearing it). The old
 * handler wrote whatever arrived, so clearing a field left an empty string behind.
 */
function normalizeText(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}
/** Prisma unique-constraint failure codes, read without casting the whole error to any. */
function prismaCode(error) {
    const code = error?.code;
    return typeof code === 'string' ? code : undefined;
}
/** Which columns a P2002 violation was on, so the message can name the real field. */
function prismaConflictTarget(error) {
    const target = error?.meta?.target;
    if (typeof target === 'string')
        return [target];
    return Array.isArray(target) ? target.filter((t) => typeof t === 'string') : [];
}
/**
 * Whether a unique-constraint failure is about the employee code.
 *
 * Prisma reports the constraint by its DB name: a unique INDEX (which is what our
 * `@unique` creates) arrives as the index name (currently `Driver_employeeCode_key`),
 * while a unique CONSTRAINT would arrive as a column name. Matching on "employee"
 * covers both across any future rename.
 */
function isEmployeeCodeConflict(target) {
    return target.some(t => t.toLowerCase().includes('employee'));
}
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
        const { name, phone, licenseNo, employeeCode } = req.body;
        if (typeof name !== 'string' || name.trim() === '') {
            return res.status(400).json({ error: 'Driver name is required' });
        }
        // Optional: a driver without an employee code simply cannot be scanned in.
        // If one is supplied it must be short enough to be a badge value.
        const code = normalizeText(employeeCode) ?? null;
        if (code !== null && code.length > MAX_EMPLOYEE_CODE_LENGTH) {
            return res.status(400).json({ error: `Employee code cannot exceed ${MAX_EMPLOYEE_CODE_LENGTH} characters` });
        }
        const driver = await prisma_1.default.driver.create({
            data: {
                name: name.trim(),
                phone: normalizeText(phone) ?? null,
                licenseNo: normalizeText(licenseNo) ?? null,
                employeeCode: code
            }
        });
        res.status(201).json(driver);
    }
    catch (error) {
        if (prismaCode(error) === 'P2002') {
            const target = prismaConflictTarget(error);
            if (isEmployeeCodeConflict(target)) {
                return res.status(400).json({ error: 'That employee code is already in use' });
            }
            if (target.includes('userId')) {
                return res.status(400).json({ error: 'That driver already has a login' });
            }
            return res.status(400).json({ error: 'A driver with those details already exists' });
        }
        res.status(500).json({ error: 'Failed to create driver' });
    }
};
exports.createDriver = createDriver;
const updateDriver = async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, phone, licenseNo, employeeCode, status } = req.body;
        const existing = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!existing)
            return res.status(404).json({ error: 'Driver not found' });
        const code = normalizeText(employeeCode);
        if (code !== undefined && code !== null && code.length > MAX_EMPLOYEE_CODE_LENGTH) {
            return res.status(400).json({ error: `Employee code cannot exceed ${MAX_EMPLOYEE_CODE_LENGTH} characters` });
        }
        const driver = await prisma_1.default.driver.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name: typeof name === 'string' && name.trim() !== '' ? name.trim() : existing.name } : {}),
                ...(phone !== undefined ? { phone: normalizeText(phone) ?? null } : {}),
                ...(licenseNo !== undefined ? { licenseNo: normalizeText(licenseNo) ?? null } : {}),
                ...(employeeCode !== undefined ? { employeeCode: code ?? null } : {}),
                ...(status !== undefined ? { status } : {})
            }
        });
        res.json(driver);
    }
    catch (error) {
        if (prismaCode(error) === 'P2002') {
            const target = prismaConflictTarget(error);
            if (isEmployeeCodeConflict(target)) {
                return res.status(400).json({ error: 'That employee code is already in use' });
            }
            if (target.includes('userId')) {
                return res.status(400).json({ error: 'That driver already has a login' });
            }
            return res.status(400).json({ error: 'A driver with those details already exists' });
        }
        res.status(500).json({ error: 'Failed to update driver' });
    }
};
exports.updateDriver = updateDriver;
/**
 * Replace a driver's photo.
 *
 * multer has already written the file to disk by the time this runs, so every early
 * exit has to remove it again - otherwise a mistyped driver id would leave an orphan
 * image that nothing references. The old photo is only unlinked after the new row is
 * committed: leaking one file is recoverable, deleting a photo the update failed to
 * replace is not.
 */
const uploadDriverPhoto = async (req, res) => {
    try {
        const id = String(req.params.id);
        const file = (0, upload_1.uploadedFile)(req);
        const driver = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!driver) {
            if (file)
                await (0, upload_1.deleteUploadFile)(`/uploads/drivers/${file.filename}`);
            return res.status(404).json({ error: 'Driver not found' });
        }
        if (!file) {
            return res.status(400).json({ error: 'Photo is required. Send it as a "photo" file field.' });
        }
        const photoUrl = `/uploads/drivers/${file.filename}`;
        const updated = await prisma_1.default.driver.update({
            where: { id },
            data: { photoUrl },
            include: {
                _count: { select: { machines: true } },
                user: { select: { id: true, name: true, email: true, isActive: true } }
            }
        });
        if (driver.photoUrl && driver.photoUrl !== photoUrl) {
            await (0, upload_1.deleteUploadFile)(driver.photoUrl);
        }
        res.json(updated);
    }
    catch (error) {
        console.error('Failed to upload driver photo:', error);
        res.status(500).json({ error: 'Failed to save photo' });
    }
};
exports.uploadDriverPhoto = uploadDriverPhoto;
const removeDriverPhoto = async (req, res) => {
    try {
        const id = String(req.params.id);
        const driver = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!driver)
            return res.status(404).json({ error: 'Driver not found' });
        // Nothing to do rather than an error: clearing an absent photo is idempotent.
        if (!driver.photoUrl)
            return res.json({ ...driver, photoUrl: null });
        const updated = await prisma_1.default.driver.update({
            where: { id },
            data: { photoUrl: null },
            include: {
                _count: { select: { machines: true } },
                user: { select: { id: true, name: true, email: true, isActive: true } }
            }
        });
        await (0, upload_1.deleteUploadFile)(driver.photoUrl);
        res.json(updated);
    }
    catch (error) {
        console.error('Failed to remove driver photo:', error);
        res.status(500).json({ error: 'Failed to remove photo' });
    }
};
exports.removeDriverPhoto = removeDriverPhoto;
const deleteDriver = async (req, res) => {
    try {
        const id = String(req.params.id);
        const driver = await prisma_1.default.driver.findUnique({ where: { id } });
        if (!driver)
            return res.status(404).json({ error: 'Driver not found' });
        // Delete the row first: a failed unlink must never stop a driver being removed.
        await prisma_1.default.driver.delete({ where: { id } });
        await (0, upload_1.deleteUploadFile)(driver.photoUrl);
        res.status(204).send();
    }
    catch (error) {
        if (prismaCode(error) === 'P2003') {
            return res.status(409).json({ error: 'This driver still has gate logs or movements attached and cannot be deleted' });
        }
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

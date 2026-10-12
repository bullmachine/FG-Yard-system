"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUser = exports.createUser = exports.getAllUsers = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const USER_ROLES = ['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY'];
const userSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
};
const isUserRole = (role) => typeof role === 'string' && USER_ROLES.includes(role);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isUniqueConstraintError = (error) => error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const getAllUsers = async (req, res) => {
    try {
        const users = await prisma_1.default.user.findMany({
            select: userSelect,
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        });
        res.json(users);
    }
    catch {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};
exports.getAllUsers = getAllUsers;
const createUser = async (req, res) => {
    try {
        const { name, email, password, role = 'VIEW_ONLY', isActive = true } = req.body;
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const normalizedRole = isUserRole(role) ? role : null;
        if (!normalizedName || !normalizedEmail || !isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Name, email, and a valid email address are required' });
        }
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive must be a boolean' });
        }
        if (!normalizedRole) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        const user = await prisma_1.default.user.create({
            data: {
                name: normalizedName,
                email: normalizedEmail,
                password: await (0, auth_1.hashPassword)(password),
                role: normalizedRole,
                isActive,
            },
            select: userSelect,
        });
        res.status(201).json(user);
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
};
exports.createUser = createUser;
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = Array.isArray(id) ? id[0] : id;
        const { name, email, password, role, isActive } = req.body;
        const currentUserId = req.userId;
        const existingUser = await prisma_1.default.user.findUnique({
            where: { id: userId },
        });
        if (!existingUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (role !== undefined && !isUserRole(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive must be a boolean' });
        }
        const nextRole = role === undefined ? existingUser.role : role;
        const nextIsActive = isActive === undefined ? existingUser.isActive : isActive;
        if (userId === currentUserId && (nextRole !== existingUser.role || !nextIsActive)) {
            return res.status(400).json({ error: 'You cannot change your own role or deactivate your account' });
        }
        const removesActiveAdmin = existingUser.role === 'ADMIN' && existingUser.isActive && (nextRole !== 'ADMIN' || !nextIsActive);
        if (removesActiveAdmin) {
            const activeAdminCount = await prisma_1.default.user.count({
                where: { role: 'ADMIN', isActive: true }
            });
            if (activeAdminCount <= 1) {
                return res.status(400).json({ error: 'At least one active administrator is required' });
            }
        }
        const normalizedName = name === undefined ? existingUser.name : typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = email === undefined ? existingUser.email : typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!normalizedName || !normalizedEmail || !isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Name and a valid email address are required' });
        }
        if (password !== undefined && (typeof password !== 'string' || (password.length > 0 && password.length < 8))) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        const user = await prisma_1.default.user.update({
            where: { id: userId },
            data: {
                name: normalizedName,
                email: normalizedEmail,
                role: nextRole,
                isActive: nextIsActive,
                ...(password ? { password: await (0, auth_1.hashPassword)(password) } : {}),
            },
            select: userSelect,
        });
        res.json(user);
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Failed to update user' });
    }
};
exports.updateUser = updateUser;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMe = exports.login = exports.register = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const notificationService_1 = require("../services/notificationService");
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isUniqueConstraintError = (error) => error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!normalizedName || !isValidEmail(normalizedEmail) || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Name, a valid email address, and a password of at least 8 characters are required' });
        }
        const existingUser = await prisma_1.default.user.findUnique({
            where: { email: normalizedEmail }
        });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        const hashedPassword = await (0, auth_1.hashPassword)(password);
        const user = await prisma_1.default.user.create({
            data: {
                name: normalizedName,
                email: normalizedEmail,
                password: hashedPassword,
                role: 'VIEW_ONLY'
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        });
        const token = (0, auth_1.generateToken)(user.id, user.role);
        await (0, notificationService_1.notifyEvent)({
            type: 'NEW_REGISTRATION',
            severity: 'INFO',
            title: 'New self-registered account',
            message: `${user.name} (${user.email}) registered and is active with View Only access. Assign a role if they need more.`,
            link: 'users'
        });
        res.status(201).json({ user, token });
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(400).json({ error: 'User already exists' });
        }
        res.status(500).json({ error: 'Failed to register user' });
    }
};
exports.register = register;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!normalizedEmail || typeof password !== 'string' || !password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = await prisma_1.default.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                name: true,
                email: true,
                password: true,
                role: true,
                isActive: true,
                createdAt: true,
                updatedAt: true
            }
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Check password
        const isValidPassword = await (0, auth_1.comparePassword)(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (!user.isActive) {
            return res.status(403).json({ error: 'Account is inactive' });
        }
        const token = (0, auth_1.generateToken)(user.id, user.role);
        const userWithoutPassword = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
        res.json({ user: userWithoutPassword, token });
    }
    catch {
        res.status(500).json({ error: 'Failed to login' });
    }
};
exports.login = login;
const getMe = async (req, res) => {
    try {
        const userId = req.userId;
        const user = await prisma_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    }
    catch {
        res.status(500).json({ error: 'Failed to fetch user' });
    }
};
exports.getMe = getMe;

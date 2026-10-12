"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.requireRole = exports.auth = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../lib/auth");
const auth = async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authorization.slice(7).trim();
    const decoded = (0, auth_1.verifyToken)(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true, isActive: true },
        });
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'User is inactive' });
        }
        const authenticatedRequest = req;
        authenticatedRequest.userId = user.id;
        authenticatedRequest.userRole = user.role;
        authenticatedRequest.user = user;
        next();
    }
    catch {
        res.status(500).json({ error: 'Authentication failed' });
    }
};
exports.auth = auth;
const requireRole = (roles) => {
    return (req, res, next) => {
        const userRole = req.userRole;
        if (!userRole || !roles.includes(userRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
};
exports.requireRole = requireRole;
/**
 * Populates req.user when a valid token is present, but never rejects.
 * Used on routes that are public for some callers and scoped for others, such as
 * GET /api/machines?mine=true where a driver sees only their own machines but
 * the yard screens keep working without a token.
 */
const optionalAuth = async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
        return next();
    }
    const token = authorization.slice(7).trim();
    const decoded = (0, auth_1.verifyToken)(token);
    if (!decoded)
        return next();
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true, isActive: true },
        });
        if (user?.isActive) {
            const authenticatedRequest = req;
            authenticatedRequest.userId = user.id;
            authenticatedRequest.userRole = user.role;
            authenticatedRequest.user = user;
        }
    }
    catch {
        // A lookup failure must not break an otherwise public request.
    }
    next();
};
exports.optionalAuth = optionalAuth;

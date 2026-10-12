import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { verifyToken } from '../lib/auth';

type AuthenticatedRequest = Request & {
  userId?: string;
  userRole?: string;
  user?: {
    id: string;
    role: string;
    isActive: boolean;
  };
};

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authorization.slice(7).trim();
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User is inactive' });
    }

    const authenticatedRequest = req as AuthenticatedRequest;
    authenticatedRequest.userId = user.id;
    authenticatedRequest.userRole = user.role;
    authenticatedRequest.user = user;

    next();
  } catch {
    res.status(500).json({ error: 'Authentication failed' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as AuthenticatedRequest).userRole;

    if (!userRole || !roles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

/**
 * Populates req.user when a valid token is present, but never rejects.
 * Used on routes that are public for some callers and scoped for others, such as
 * GET /api/machines?mine=true where a driver sees only their own machines but
 * the yard screens keep working without a token.
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return next();
  }

  const token = authorization.slice(7).trim();
  const decoded = verifyToken(token);
  if (!decoded) return next();

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, isActive: true },
    });

    if (user?.isActive) {
      const authenticatedRequest = req as AuthenticatedRequest;
      authenticatedRequest.userId = user.id;
      authenticatedRequest.userRole = user.role;
      authenticatedRequest.user = user;
    }
  } catch {
    // A lookup failure must not break an otherwise public request.
  }

  next();
};

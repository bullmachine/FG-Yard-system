import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { hashPassword } from '../lib/auth';

type AuthenticatedRequest = Request & { userId?: string };

const USER_ROLES = ['ADMIN', 'YARD_MANAGER', 'OPERATOR', 'SERVICE_TECHNICIAN', 'SECURITY', 'VIEW_ONLY', 'PLANNER', 'PDI', 'MAIN_GATE'] as const;
type UserRole = (typeof USER_ROLES)[number];

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const isUserRole = (role: unknown): role is UserRole => typeof role === 'string' && USER_ROLES.includes(role as UserRole);
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isUniqueConstraintError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: userSelect,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    res.json(users);
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const createUser = async (req: Request, res: Response) => {
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

    const user = await prisma.user.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        password: await hashPassword(password),
        role: normalizedRole,
        isActive,
      },
      select: userSelect,
    });

    res.status(201).json(user);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = Array.isArray(id) ? id[0] : id;
    const { name, email, password, role, isActive } = req.body;
    const currentUserId = (req as AuthenticatedRequest).userId;

    const existingUser = await prisma.user.findUnique({
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
      const activeAdminCount = await prisma.user.count({
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

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name: normalizedName,
        email: normalizedEmail,
        role: nextRole,
        isActive: nextIsActive,
        ...(password ? { password: await hashPassword(password) } : {}),
      },
      select: userSelect,
    });

    res.json(user);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Failed to update user' });
  }
};

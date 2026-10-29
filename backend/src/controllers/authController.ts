import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { permissionsFor } from '../services/roleAccessService';
import { recordLogin, recordLogout } from '../services/loginHistoryService';
import { hashPassword, comparePassword, generateToken } from '../lib/auth';
import { notifyEvent } from '../services/notificationService';
import { getSettings } from '../services/settingsService';
import { requestReset, resetPassword, CODE_MINUTES } from '../services/passwordResetService';

type AuthenticatedRequest = Request & { userId?: string };

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isUniqueConstraintError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Public: what the login page offers (Create account only when an Admin allows it). */
export const authOptions = async (_req: Request, res: Response) => {
  try {
    const { allowRegistration } = await getSettings();
    res.json({ allowRegistration, resetCodeMinutes: CODE_MINUTES });
  } catch {
    res.json({ allowRegistration: false, resetCodeMinutes: CODE_MINUTES });
  }
};

/** Body: { email }. The same answer whether or not the account exists. */
export const forgotPassword = async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid e-mail address' });
  try {
    await requestReset(req, email);
  } catch (error) {
    console.error('forgotPassword error:', error);
  }
  res.json({ ok: true });
};

/** Body: { email, code, password }. */
export const resetPasswordHandler = async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'The new password needs at least 8 characters' });
    }
    const result = await resetPassword(req, email, code, password);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  } catch (error) {
    console.error('resetPassword error:', error);
    res.status(500).json({ error: 'Failed to reset the password' });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { allowRegistration } = await getSettings();
    if (!allowRegistration) {
      return res.status(403).json({ error: 'Creating an account here is switched off. Ask your administrator for an account.' });
    }
    const { name, email, password } = req.body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedName || !isValidEmail(normalizedEmail) || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Name, a valid email address, and a password of at least 8 characters are required' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
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

    const token = generateToken(user.id, user.role);

    await notifyEvent({
      type: 'NEW_REGISTRATION',
      severity: 'INFO',
      title: 'New self-registered account',
      message: `${user.name} (${user.email}) registered and is active with View Only access. Assign a role if they need more.`,
      link: 'users'
    });

    res.status(201).json({ user: { ...user, permissions: await permissionsFor(user.role) }, token });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(400).json({ error: 'User already exists' });
    }
    res.status(500).json({ error: 'Failed to register user' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || typeof password !== 'string' || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = await prisma.user.findUnique({
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
      await recordLogin(req, normalizedEmail, 'UNKNOWN_USER', null);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await comparePassword(password, user.password);

    if (!isValidPassword) {
      await recordLogin(req, normalizedEmail, 'WRONG_PASSWORD', user.id);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      await recordLogin(req, normalizedEmail, 'INACTIVE', user.id);
      return res.status(403).json({ error: 'Account is inactive' });
    }

    await recordLogin(req, normalizedEmail, 'SUCCESS', user.id);

    const token = generateToken(user.id, user.role);
    const userWithoutPassword = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.json({ user: { ...userWithoutPassword, permissions: await permissionsFor(userWithoutPassword.role) }, token });
  } catch {
    res.status(500).json({ error: 'Failed to login' });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;

    const user = await prisma.user.findUnique({
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

    res.json({ user: { ...user, permissions: await permissionsFor(user.role) } });
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

/** Records the sign-out; the token itself is dropped by the browser. */
export const logout = async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
    if (user) await recordLogout(req, userId, user.email);
  }
  res.json({ ok: true });
};

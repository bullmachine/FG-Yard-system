import crypto from 'crypto';
import { Request } from 'express';
import prisma from '../lib/prisma';
import { hashPassword } from '../lib/auth';
import { sendMail } from './mailService';
import { getSettings } from './settingsService';
import { notifyEvent, notifyUser } from './notificationService';
import { clientIp } from './loginHistoryService';

/**
 * Forgot password: the user asks for a 6-digit code by e-mail, then sets a new password
 * with it. The answer to a request never says whether the account exists. When the
 * e-mail cannot be sent (no SMTP, or it failed), the Admins are told so they can reset
 * the password in User Management.
 */

export const CODE_MINUTES = 15;
const MAX_TRIES = 5;
const MAX_PER_HOUR = 3;
const MAX_PER_IP_HOUR = 10;

/** The code is stored hashed with the user id, so a copy of the table does not reveal it. */
export function hashCode(userId: string, code: string): string {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function record(req: Request, email: string, result: string, userId: string | null) {
  await prisma.loginEvent.create({
    data: {
      event: 'RESET',
      result,
      email: email.slice(0, 190),
      userId,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300)
    }
  }).catch((error) => console.error('password reset record error:', error));
}

/** Always resolves without telling the caller whether the account exists. */
export async function requestReset(req: Request, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const fromIp = await prisma.loginEvent.count({ where: { event: 'RESET', result: 'REQUESTED', ip: clientIp(req), createdAt: { gte: hourAgo } } });
  if (fromIp >= MAX_PER_IP_HOUR) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
  if (!user || !user.isActive) {
    await record(req, email, user ? 'INACTIVE' : 'UNKNOWN_USER', user?.id ?? null);
    return;
  }
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gte: hourAgo } } });
  if (recent >= MAX_PER_HOUR) return;

  const code = newCode();
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordReset.create({
      data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000) }
    })
  ]);
  await record(req, email, 'REQUESTED', user.id);

  let mailed = false;
  const s = await getSettings();
  if (s.smtpPassword) {
    try {
      await sendMail({
        to: [user.email],
        subject: `FG Yard password reset code: ${code}`,
        html: `<p>Hello ${user.name.replace(/[<>&]/g, '')},</p>`
          + `<p>Your FG Yard password reset code is</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>`
          + `<p>Enter it on the Forgot password page within ${CODE_MINUTES} minutes. Do not share it with anyone.</p>`
          + '<p style="color:#64748b">If you did not ask for this, ignore this e-mail; your password stays the same.</p>'
      });
      mailed = true;
    } catch (error) {
      console.error('Password reset e-mail not sent:', error instanceof Error ? error.message : error);
    }
  }
  if (!mailed) {
    await notifyEvent({
      type: 'PASSWORD_RESET_REQUEST',
      severity: 'WARNING',
      title: 'Password reset requested',
      message: `${user.name} (${user.email}) forgot the password and the code could not be e-mailed. Check it is really them, then set a new password in User Management.`,
      link: 'users'
    });
  }
}

export type ResetOutcome = { ok: true } | { ok: false; error: string };

export async function resetPassword(req: Request, rawEmail: string, code: string, password: string): Promise<ResetOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const wrong: ResetOutcome = { ok: false, error: 'The code is wrong or has expired. Check the e-mail, or ask for a new code.' };
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  if (!user || !user.isActive || !/^\d{6}$/.test(code)) return wrong;

  const reset = await prisma.passwordReset.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!reset) return wrong;
  if (reset.attempts >= MAX_TRIES) return { ok: false, error: 'Too many wrong codes. Ask for a new code.' };

  const match = crypto.timingSafeEqual(Buffer.from(reset.codeHash, 'hex'), Buffer.from(hashCode(user.id, code), 'hex'));
  if (!match) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    await record(req, email, 'WRONG_CODE', user.id);
    return wrong;
  }

  // Changing the password also signs the account out everywhere (auth middleware).
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password: await hashPassword(password), passwordChangedAt: new Date() } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } })
  ]);
  await record(req, email, 'SUCCESS', user.id);
  await notifyUser(user.id, {
    type: 'PASSWORD_CHANGED',
    severity: 'WARNING',
    title: 'Your password was changed',
    message: 'Your password was reset with an e-mail code. If this was not you, tell your administrator at once.'
  });
  return { ok: true };
}

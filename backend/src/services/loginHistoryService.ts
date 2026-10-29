import { Request } from 'express';
import prisma from '../lib/prisma';
import { notifyEvent } from './notificationService';

/**
 * Sign-in history for security: every login attempt and logout, with the IP address
 * and device. IP addresses linked to named users are personal data (DPDPA), so only an
 * Admin can read the history and rows older than RETENTION_DAYS are deleted daily.
 */

export const RETENTION_DAYS = 90;
const FAIL_LIMIT = 5;
const FAIL_WINDOW_MIN = 15;

export type LoginResult = 'SUCCESS' | 'WRONG_PASSWORD' | 'UNKNOWN_USER' | 'INACTIVE';

/**
 * The caller's IP. index.ts trusts X-Forwarded-For only from the local IIS proxy, so
 * req.ip is the user's address behind IIS and the direct address otherwise.
 */
export function clientIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/** A short "Browser on OS" label from the user agent, for reading the list. */
export function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
  return `${browser} on ${os}`;
}

export async function recordLogin(req: Request, email: string, result: LoginResult, userId: string | null) {
  try {
    const ip = clientIp(req);
    await prisma.loginEvent.create({
      data: {
        event: 'LOGIN',
        result,
        email: email.slice(0, 190),
        userId,
        ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300)
      }
    });
    if (result !== 'SUCCESS') await alertOnRepeatedFailures(email, ip);
  } catch (error) {
    // Recording must never block a sign-in.
    console.error('recordLogin error:', error);
  }
}

export async function recordLogout(req: Request, userId: string, email: string) {
  try {
    await prisma.loginEvent.create({
      data: {
        event: 'LOGOUT',
        result: 'SUCCESS',
        email: email.slice(0, 190),
        userId,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300)
      }
    });
  } catch (error) {
    console.error('recordLogout error:', error);
  }
}

/** Alert the Admins once when one account reaches FAIL_LIMIT failed sign-ins in the window. */
async function alertOnRepeatedFailures(email: string, ip: string) {
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60_000);
  const failures = await prisma.loginEvent.count({
    where: { event: 'LOGIN', email, result: { not: 'SUCCESS' }, createdAt: { gte: since } }
  });
  if (failures !== FAIL_LIMIT) return;
  await notifyEvent({
    type: 'LOGIN_FAILED',
    severity: 'WARNING',
    title: `${FAIL_LIMIT} failed sign-ins for ${email}`,
    message: `${FAIL_LIMIT} failed sign-in attempts for ${email} in ${FAIL_WINDOW_MIN} minutes, the last from IP ${ip || 'unknown'}. If this was not the user, check the account in User Management.`,
    link: 'logins'
  });
}

/** Delete history older than the retention period. Run daily by the scheduler. */
export async function purgeOldLoginEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count) console.log(`Login history: deleted ${count} event(s) older than ${RETENTION_DAYS} days`);
  return count;
}

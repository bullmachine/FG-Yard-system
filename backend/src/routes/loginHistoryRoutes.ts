import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { auth, requireRole } from '../middleware/auth';
import { deviceLabel, RETENTION_DAYS } from '../services/loginHistoryService';

const router = Router();

function day(raw: unknown, endOfDay: boolean): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Admin only. Query: result (SUCCESS | FAILED | LOGOUT), q (email, name or IP), from, to
 * (YYYY-MM-DD), page, pageSize. Also returns today's counts for the cards.
 */
router.get('/', auth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const from = day(req.query.from, false);
    const to = day(req.query.to, true);
    const result = req.query.result;

    const where = {
      ...(result === 'SUCCESS' && { event: 'LOGIN', result: 'SUCCESS' }),
      ...(result === 'FAILED' && { event: 'LOGIN', result: { not: 'SUCCESS' } }),
      ...(result === 'LOGOUT' && { event: 'LOGOUT' }),
      ...(q && { OR: [{ email: { contains: q } }, { ip: { contains: q } }, { user: { name: { contains: q } } }] }),
      ...((from || to) && { createdAt: { ...(from && { gte: from }), ...(to && { lte: to }) } })
    };
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = { createdAt: { gte: startOfToday } };

    const [rows, total, okToday, failedToday, usersToday] = await prisma.$transaction([
      prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { name: true, role: true } } }
      }),
      prisma.loginEvent.count({ where }),
      prisma.loginEvent.count({ where: { ...today, event: 'LOGIN', result: 'SUCCESS' } }),
      prisma.loginEvent.count({ where: { ...today, event: 'LOGIN', result: { not: 'SUCCESS' } } }),
      prisma.loginEvent.findMany({ where: { ...today, event: 'LOGIN', result: 'SUCCESS' }, distinct: ['email'], select: { email: true } })
    ]);

    res.json({
      items: rows.map((r) => ({ ...r, device: deviceLabel(r.userAgent) })),
      total,
      page,
      pageSize,
      retentionDays: RETENTION_DAYS,
      today: { success: okToday, failed: failedToday, users: usersToday.length }
    });
  } catch (error) {
    console.error('login history error:', error);
    res.status(500).json({ error: 'Failed to load login history' });
  }
});

export default router;

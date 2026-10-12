import { Request, Response } from 'express';
import prisma from '../lib/prisma';

/**
 * Read-only history of security walk-downs. Every APPROVED/REJECTED decision
 * made at verifyParking is stored as a SecurityVerification row; this endpoint
 * is the only way to read them back, so the Security screen and the History tab
 * can show what happened after the pending queue clears.
 */
export const getSecurityVerifications = async (req: Request, res: Response) => {
  try {
    const { status, machineId, from, to } = req.query;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const rawPageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));

    const where: Record<string, unknown> = {};
    if (status) where.status = String(status);
    if (machineId) where.machineId = String(machineId);

    // verifiedAt is the decision time. A partial range (only from, or only to)
    // is valid, so the bounds are added individually.
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.gte = new Date(String(from));
      if (to) range.lte = new Date(String(to));
      where.verifiedAt = range;
    }

    const [items, total] = await prisma.$transaction([
      prisma.securityVerification.findMany({
        where,
        include: {
          machine: { select: { id: true, serialNumber: true, model: true } },
          slot: { select: { row: true, col: true, yard: { select: { name: true } } } },
          user: { select: { id: true, name: true } }
        },
        orderBy: { verifiedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.securityVerification.count({ where })
    ]);

    res.json({ items, total, page, pageSize });
  } catch (error) {
    console.error('Failed to fetch security verifications:', error);
    res.status(500).json({ error: 'Failed to fetch security verifications' });
  }
};

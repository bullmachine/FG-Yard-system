import { Request, Response } from 'express';
import prisma from '../lib/prisma';

/**
 * Read-only movement log. The History screen used to build this by downloading
 * every machine and flattening its movements client-side, which pulled the
 * whole plant over the wire. Serving it directly allows server-side filtering
 * (notably reason=YARD_ENTRY, the parking confirmations) and real pagination.
 */
export const getMovements = async (req: Request, res: Response) => {
  try {
    const { reason, machineId, from, to } = req.query;

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const rawPageSize = parseInt(String(req.query.pageSize ?? '20'), 10) || 20;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));

    const where: Record<string, unknown> = {};
    if (reason) where.reason = String(reason);
    if (machineId) where.machineId = String(machineId);

    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.gte = new Date(String(from));
      if (to) range.lte = new Date(String(to));
      where.timestamp = range;
    }

    const [items, total] = await prisma.$transaction([
      prisma.movement.findMany({
        where,
        include: {
          machine: { select: { id: true, serialNumber: true, model: true } },
          yard: { select: { name: true } },
          // Each slot carries its own yard, because a relocation writes the
          // destination yard onto the movement. Reading the yard off the slot
          // keeps the origin of a cross-yard move labelled correctly.
          fromSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
          toSlot: { select: { row: true, col: true, yard: { select: { name: true } } } },
          // role is included so the UI can tell a driver self-confirming from the
          // yard office recording it on the driver's behalf.
          user: { select: { id: true, name: true, role: true } }
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.movement.count({ where })
    ]);

    res.json({ items, total, page, pageSize });
  } catch (error) {
    console.error('Failed to fetch movements:', error);
    res.status(500).json({ error: 'Failed to fetch movements' });
  }
};

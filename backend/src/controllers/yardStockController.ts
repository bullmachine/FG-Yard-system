import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { loadStock } from '../services/yardStockService';

function actor(req: Request) {
  return (req as Request & { user?: { id: string; role?: string } }).user;
}

/**
 * Yard stock by model-type, each group listed in FIFO order (see yardStockService for
 * how the inward date is chosen).
 *
 * Only free stock (verified, not reserved, no open exit request) is numbered for
 * dispatch. Reserved machines, machines on an exit request and machines still waiting
 * for (or rejected by) security are counted separately so the physical count adds up.
 */
export const getYardStock = async (req: Request, res: Response) => {
  try {
    const yardId = typeof req.query.yardId === 'string' && req.query.yardId ? req.query.yardId : null;
    const rows = (await loadStock({ yardId, includeDemo: req.query.includeDemo === 'true' })).map((r) => ({
      ...r,
      inwardAt: r.inwardAt ? r.inwardAt.toISOString() : null
    }));

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = groups.get(r.modelType) ?? [];
      list.push(r);
      groups.set(r.modelType, list);
    }

    const result = [...groups.entries()].map(([modelType, list]) => {
      // FIFO rank only among free stock: that is the dispatch order.
      let rank = 0;
      const ranked = list.map((r) => ({ ...r, fifoRank: r.available ? ++rank : null }));
      const oldest = ranked.find((r) => r.available && r.inwardAt);
      return {
        modelType,
        available: ranked.filter((r) => r.available).length,
        reserved: ranked.filter((r) => r.reservedFor).length,
        onHold: ranked.filter((r) => r.verified && !r.reservedFor && r.exitPending).length,
        pendingVerify: ranked.filter((r) => !r.verified && !r.reservedFor).length,
        total: ranked.length,
        oldestInwardAt: oldest?.inwardAt ?? null,
        oldestDays: oldest?.daysInYard ?? null,
        machines: ranked
      };
    }).sort((a, b) => b.available - a.available || a.modelType.localeCompare(b.modelType));

    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        available: result.reduce((n, g) => n + g.available, 0),
        reserved: result.reduce((n, g) => n + g.reserved, 0),
        onHold: result.reduce((n, g) => n + g.onHold, 0),
        pendingVerify: result.reduce((n, g) => n + g.pendingVerify, 0),
        total: rows.length,
        modelTypes: result.length,
        undated: rows.filter((r) => r.inwardSource === 'UNKNOWN').length,
        estimated: rows.filter((r) => r.inwardSource === 'STAGE18').length
      },
      groups: result
    });
  } catch (error) {
    console.error('getYardStock error:', error);
    res.status(500).json({ error: 'Failed to load yard stock' });
  }
};

/**
 * Set or clear the real yard inward date of one machine. Used for stock that was
 * already in the yard before go-live; it overrides the gate and stage-18 dates.
 * Body: { date: 'YYYY-MM-DD' } to set, { date: null } to clear.
 */
export const setInwardDate = async (req: Request, res: Response) => {
  try {
    const raw = req.params.machineId;
    const machineId = Array.isArray(raw) ? raw[0] : raw;
    const value = req.body?.date;

    let date: Date | null = null;
    if (value !== null && value !== undefined && value !== '') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
      }
      // Midday local time, so the stored day does not shift across time zones.
      date = new Date(`${value}T12:00:00`);
      if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
      if (date.getTime() > Date.now()) return res.status(400).json({ error: 'Inward date cannot be in the future' });
    }

    const machine = await prisma.machine.findUnique({ where: { id: machineId }, select: { id: true, serialNumber: true } });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    await prisma.machine.update({ where: { id: machineId }, data: { yardInwardAt: date } });
    console.log(`Inward date for ${machine.serialNumber} ${date ? `set to ${value}` : 'cleared'} by user ${actor(req)?.id}`);

    res.json({ ok: true, machineId, yardInwardAt: date ? date.toISOString() : null });
  } catch (error) {
    console.error('setInwardDate error:', error);
    res.status(500).json({ error: 'Failed to update inward date' });
  }
};

import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { notifyEvent, notifyUser } from '../services/notificationService';

/**
 * Feedback, suggestions and issues from any signed-in user. The sender sees their
 * own; an Admin sees all, sets the status and writes a reply the sender can read.
 */

const TYPES = ['SUGGESTION', 'ISSUE', 'OTHER'];
const STATUSES = ['NEW', 'IN_PROGRESS', 'DONE', 'CLOSED'];
const TYPE_LABEL: Record<string, string> = { SUGGESTION: 'Suggestion', ISSUE: 'Issue', OTHER: 'Feedback' };
const STATUS_LABEL: Record<string, string> = { NEW: 'New', IN_PROGRESS: 'In progress', DONE: 'Done', CLOSED: 'Closed' };

const include = {
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  handledBy: { select: { id: true, name: true } }
};

function actor(req: Request) {
  return (req as Request & { user?: { id: string; role: string } }).user;
}

function param(req: Request, key: string): string {
  const raw = req.params[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Body: { type, message, page? } */
export const createFeedback = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const type = typeof req.body?.type === 'string' ? req.body.type : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const page = typeof req.body?.page === 'string' ? req.body.page.trim().slice(0, 60) || null : null;
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Choose Suggestion, Issue or Other' });
    if (message.length < 5) return res.status(400).json({ error: 'Write a few words (at least 5 characters)' });
    if (message.length > 4000) return res.status(400).json({ error: 'Keep it under 4000 characters' });

    const saved = await prisma.feedback.create({
      data: { type, message, page, createdById: user.id },
      include
    });
    await notifyEvent({
      type: 'FEEDBACK_NEW',
      severity: type === 'ISSUE' ? 'WARNING' : 'INFO',
      title: `New ${TYPE_LABEL[type].toLowerCase()} from ${saved.createdBy.name}`,
      message: `${page ? `${page}: ` : ''}${message.slice(0, 180)}${message.length > 180 ? '…' : ''}`,
      link: 'feedback'
    });
    res.status(201).json(saved);
  } catch (error) {
    console.error('createFeedback error:', error);
    res.status(500).json({ error: 'Failed to send feedback' });
  }
};

/** The signed-in user's own feedback, newest first. */
export const listMyFeedback = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const items = await prisma.feedback.findMany({
      where: { createdById: user.id },
      include,
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(items);
  } catch (error) {
    console.error('listMyFeedback error:', error);
    res.status(500).json({ error: 'Failed to load your feedback' });
  }
};

/** Admin. Query: status, type, q, page, pageSize. Also returns the count per status. */
export const listFeedback = async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const type = typeof req.query.type === 'string' && TYPES.includes(req.query.type) ? req.query.type : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10) || 25));

    const where = {
      ...(status && { status }),
      ...(type && { type }),
      ...(q && { OR: [{ message: { contains: q } }, { page: { contains: q } }, { createdBy: { name: { contains: q } } }] })
    };
    const [items, total, grouped] = await prisma.$transaction([
      prisma.feedback.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.feedback.count({ where }),
      prisma.feedback.groupBy({ by: ['status'], orderBy: { status: 'asc' }, _count: { _all: true } })
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = (g._count as { _all: number })._all;
    res.json({ items, total, page, pageSize, counts });
  } catch (error) {
    console.error('listFeedback error:', error);
    res.status(500).json({ error: 'Failed to load feedback' });
  }
};

/** Admin. Body: { status?, adminNote? } */
export const updateFeedback = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const current = await prisma.feedback.findUnique({ where: { id: param(req, 'id') } });
    if (!current) return res.status(404).json({ error: 'Feedback not found' });

    const status = req.body?.status;
    if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
    const note = req.body?.adminNote;
    if (note !== undefined && note !== null && typeof note !== 'string') return res.status(400).json({ error: 'Reply must be text' });
    const adminNote = typeof note === 'string' ? note.trim().slice(0, 4000) || null : undefined;

    const saved = await prisma.feedback.update({
      where: { id: current.id },
      data: {
        ...(status !== undefined && { status }),
        ...(adminNote !== undefined && { adminNote }),
        handledById: user.id,
        handledAt: new Date()
      },
      include
    });

    const statusChanged = status !== undefined && status !== current.status;
    const noteChanged = adminNote !== undefined && adminNote !== current.adminNote;
    if ((statusChanged || noteChanged) && saved.createdById !== user.id) {
      await notifyUser(saved.createdById, {
        type: 'FEEDBACK_UPDATED',
        severity: 'INFO',
        title: `Your ${TYPE_LABEL[saved.type].toLowerCase()} is ${STATUS_LABEL[saved.status].toLowerCase()}`,
        message: saved.adminNote ? `Reply: ${saved.adminNote.slice(0, 200)}` : `"${saved.message.slice(0, 120)}"`,
        link: 'feedback'
      });
    }
    res.json(saved);
  } catch (error) {
    console.error('updateFeedback error:', error);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
};

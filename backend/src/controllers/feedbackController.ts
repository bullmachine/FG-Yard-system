import fs from 'fs';
import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { notifyEvent, notifyUser } from '../services/notificationService';
import { sendMail } from '../services/mailService';
import { getSettings } from '../services/settingsService';
import { deleteFile, feedbackScreenshotPath, uploadedFile } from '../lib/upload';

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

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * E-mail the feedback to Settings > feedback alert e-mails, or to every active Admin
 * when that is empty. Best effort: the feedback is already saved and notified in-app.
 */
async function mailFeedback(f: { type: string; page: string | null; message: string; screenshot: string | null; createdBy: { name: string; email: string } }) {
  try {
    const s = await getSettings();
    if (!s.smtpPassword) return;
    let to = s.feedbackAlertEmails.split(/[,;\s]+/).filter(Boolean);
    if (to.length === 0) {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { email: true } });
      to = admins.map((a) => a.email);
    }
    if (to.length === 0) return;
    await sendMail({
      to,
      subject: `FG Yard: new ${TYPE_LABEL[f.type].toLowerCase()} from ${f.createdBy.name}`,
      html: `<p><b>${escapeHtml(TYPE_LABEL[f.type])}</b> from ${escapeHtml(f.createdBy.name)} (${escapeHtml(f.createdBy.email)})${f.page ? ` on <b>${escapeHtml(f.page)}</b>` : ''}</p>`
        + `<p style="white-space:pre-wrap">${escapeHtml(f.message)}</p>`
        + `<p style="color:#64748b">${f.screenshot ? 'A screenshot is attached in FG Yard. ' : ''}Open FG Yard &gt; Feedback to reply.</p>`
    });
  } catch (error) {
    console.error('Feedback e-mail not sent:', error instanceof Error ? error.message : error);
  }
}

/** Body (JSON or multipart): { type, message, page? } plus an optional screenshot file. */
export const createFeedback = async (req: Request, res: Response) => {
  const file = uploadedFile(req);
  try {
    const user = actor(req);
    if (!user?.id) {
      if (file) await deleteFile(file.path);
      return res.status(401).json({ error: 'Authentication required' });
    }
    const type = typeof req.body?.type === 'string' ? req.body.type : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const page = typeof req.body?.page === 'string' ? req.body.page.trim().slice(0, 60) || null : null;
    const invalid = !TYPES.includes(type) ? 'Choose Suggestion, Issue or Other'
      : message.length < 5 ? 'Write a few words (at least 5 characters)'
      : message.length > 4000 ? 'Keep it under 4000 characters' : '';
    if (invalid) {
      if (file) await deleteFile(file.path);
      return res.status(400).json({ error: invalid });
    }

    const saved = await prisma.feedback.create({
      data: { type, message, page, screenshot: file?.filename ?? null, createdById: user.id },
      include
    });
    void mailFeedback(saved);
    await notifyEvent({
      type: 'FEEDBACK_NEW',
      severity: type === 'ISSUE' ? 'WARNING' : 'INFO',
      title: `New ${TYPE_LABEL[type].toLowerCase()} from ${saved.createdBy.name}`,
      message: `${page ? `${page}: ` : ''}${message.slice(0, 180)}${message.length > 180 ? '…' : ''}`,
      link: 'feedback'
    });
    res.status(201).json(saved);
  } catch (error) {
    if (file) await deleteFile(file.path);
    console.error('createFeedback error:', error);
    res.status(500).json({ error: 'Failed to send feedback' });
  }
};

/** The screenshot of one feedback, for its sender or an Admin. */
export const getScreenshot = async (req: Request, res: Response) => {
  try {
    const user = actor(req);
    if (!user?.id) return res.status(401).json({ error: 'Authentication required' });
    const f = await prisma.feedback.findUnique({ where: { id: param(req, 'id') }, select: { createdById: true, screenshot: true } });
    if (!f || (f.createdById !== user.id && user.role !== 'ADMIN')) return res.status(404).json({ error: 'Not found' });
    const file = feedbackScreenshotPath(f.screenshot);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'No screenshot' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(file);
  } catch (error) {
    console.error('getScreenshot error:', error);
    res.status(500).json({ error: 'Failed to load the screenshot' });
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

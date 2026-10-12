import { Request, Response } from 'express';
import {
  listNotifications,
  countUnread,
  markRead,
  markAllRead
} from '../services/notificationService';
import { connectedUserCount } from '../services/realtime';

type AuthenticatedRequest = Request & { userId?: string };

const getUserId = (req: Request): string | null => {
  const userId = (req as AuthenticatedRequest).userId;
  return typeof userId === 'string' && userId ? userId : null;
};

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const [notifications, unreadCount] = await Promise.all([
      listNotifications(userId),
      countUnread(userId)
    ]);

    res.json({ notifications, unreadCount, realtimeUsers: connectedUserCount() });
  } catch {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    res.json({ unreadCount: await countUnread(userId) });
  } catch {
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

export const markNotificationsRead = async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { ids } = req.body;
    const updated = Array.isArray(ids)
      ? await markRead(userId, ids.filter((id: unknown) => typeof id === 'string'))
      : await markAllRead(userId);

    res.json({ updated, unreadCount: await countUnread(userId) });
  } catch {
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
};

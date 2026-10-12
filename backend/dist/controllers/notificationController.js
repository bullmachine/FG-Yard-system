"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markNotificationsRead = exports.getUnreadCount = exports.getNotifications = void 0;
const notificationService_1 = require("../services/notificationService");
const realtime_1 = require("../services/realtime");
const getUserId = (req) => {
    const userId = req.userId;
    return typeof userId === 'string' && userId ? userId : null;
};
const getNotifications = async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId)
            return res.status(401).json({ error: 'Authentication required' });
        const [notifications, unreadCount] = await Promise.all([
            (0, notificationService_1.listNotifications)(userId),
            (0, notificationService_1.countUnread)(userId)
        ]);
        res.json({ notifications, unreadCount, realtimeUsers: (0, realtime_1.connectedUserCount)() });
    }
    catch {
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};
exports.getNotifications = getNotifications;
const getUnreadCount = async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId)
            return res.status(401).json({ error: 'Authentication required' });
        res.json({ unreadCount: await (0, notificationService_1.countUnread)(userId) });
    }
    catch {
        res.status(500).json({ error: 'Failed to fetch unread count' });
    }
};
exports.getUnreadCount = getUnreadCount;
const markNotificationsRead = async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId)
            return res.status(401).json({ error: 'Authentication required' });
        const { ids } = req.body;
        const updated = Array.isArray(ids)
            ? await (0, notificationService_1.markRead)(userId, ids.filter((id) => typeof id === 'string'))
            : await (0, notificationService_1.markAllRead)(userId);
        res.json({ updated, unreadCount: await (0, notificationService_1.countUnread)(userId) });
    }
    catch {
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
};
exports.markNotificationsRead = markNotificationsRead;

import { Router } from 'express';
import {
  getNotifications,
  getUnreadCount,
  markNotificationsRead
} from '../controllers/notificationController';
import { auth } from '../middleware/auth';

const router = Router();

router.get('/', auth, getNotifications);
router.get('/unread-count', auth, getUnreadCount);
router.post('/read', auth, markNotificationsRead);

export default router;

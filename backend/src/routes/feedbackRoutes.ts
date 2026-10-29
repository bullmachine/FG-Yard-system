import { Router } from 'express';
import { createFeedback, listMyFeedback, listFeedback, updateFeedback, getScreenshot } from '../controllers/feedbackController';
import { auth, requireRole } from '../middleware/auth';
import { feedbackScreenshotUpload } from '../lib/upload';

const router = Router();

// Any signed-in user sends feedback and reads their own; only an Admin reviews it.
// JSON, or multipart with an optional "screenshot" image.
router.post('/', auth, feedbackScreenshotUpload, createFeedback);
// The sender or an Admin.
router.get('/:id/screenshot', auth, getScreenshot);
router.get('/mine', auth, listMyFeedback);
router.get('/', auth, requireRole(['ADMIN']), listFeedback);
router.put('/:id', auth, requireRole(['ADMIN']), updateFeedback);

export default router;

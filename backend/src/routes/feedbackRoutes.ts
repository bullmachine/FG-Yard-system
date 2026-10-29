import { Router } from 'express';
import { createFeedback, listMyFeedback, listFeedback, updateFeedback } from '../controllers/feedbackController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

// Any signed-in user sends feedback and reads their own; only an Admin reviews it.
router.post('/', auth, createFeedback);
router.get('/mine', auth, listMyFeedback);
router.get('/', auth, requireRole(['ADMIN']), listFeedback);
router.put('/:id', auth, requireRole(['ADMIN']), updateFeedback);

export default router;

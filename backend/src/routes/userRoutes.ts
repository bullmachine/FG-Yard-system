import { Router } from 'express';
import { getAllUsers, createUser, updateUser } from '../controllers/userController';
import { auth, requireRole } from '../middleware/auth';

const router = Router();

router.get('/', auth, requireRole(['ADMIN']), getAllUsers);
router.post('/', auth, requireRole(['ADMIN']), createUser);
router.put('/:id', auth, requireRole(['ADMIN']), updateUser);

export default router;

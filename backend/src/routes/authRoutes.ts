import { Router } from 'express';
import { register, login, getMe, logout, authOptions, forgotPassword, resetPasswordHandler } from '../controllers/authController';
import { auth } from '../middleware/auth';

const router = Router();

router.get('/options', authOptions);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPasswordHandler);
router.post('/login', login);
router.get('/me', auth, getMe);
router.post('/logout', auth, logout);

export default router;

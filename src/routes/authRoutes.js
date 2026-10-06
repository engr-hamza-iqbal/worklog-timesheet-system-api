import express from 'express';
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
  handleEventStream,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/register', createRateLimiter({ key: 'register', windowMs: 15 * 60 * 1000, max: 5 }), handleRegister);
router.post('/login', createRateLimiter({ key: 'login', windowMs: 15 * 60 * 1000, max: 10 }), handleLogin);
router.get('/me', authenticate, handleGetMe);
router.get('/stream', authenticate, handleEventStream);
router.post('/logout', authenticate, handleLogout);

export default router;

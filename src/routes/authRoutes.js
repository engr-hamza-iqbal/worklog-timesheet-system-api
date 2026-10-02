import express from 'express';
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
  handleEventStream,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', handleRegister);
router.post('/login', handleLogin);
router.get('/me', authenticate, handleGetMe);
router.get('/stream', handleEventStream);
router.post('/logout', authenticate, handleLogout);

export default router;

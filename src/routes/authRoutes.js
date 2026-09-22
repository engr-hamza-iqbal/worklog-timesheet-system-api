import express from 'express';
import {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/register', handleRegister);
router.post('/login', handleLogin);
router.get('/me', authenticate, handleGetMe);
router.post('/logout', authenticate, handleLogout);

export default router;

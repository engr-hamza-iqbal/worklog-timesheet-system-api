import express from 'express';
import {
  handleSendOtp,
  handleSendResetOtp,
  handleVerifyResetOtp,
  handleVerifyOtp,
  handleResetPassword,
  handleRegister,
  handleLogin,
  handleCreateInvitation,
  handleListInvitations,
  handleVerifyInvitation,
  handleRevokeInvitation,
  handleGetMe,
  handleUpdateProfile,
  handleLogout,
  handleEventStream,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { requireCapability } from '../middleware/permission.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/send-otp', createRateLimiter({ key: 'send-otp', windowMs: 15 * 60 * 1000, max: 10 }), handleSendOtp);
router.post('/verify-otp', createRateLimiter({ key: 'verify-otp', windowMs: 15 * 60 * 1000, max: 30 }), handleVerifyOtp);
router.post('/send-reset-otp', createRateLimiter({ key: 'send-reset-otp', windowMs: 15 * 60 * 1000, max: 10 }), handleSendResetOtp);
router.post('/verify-reset-otp', createRateLimiter({ key: 'verify-reset-otp', windowMs: 15 * 60 * 1000, max: 30 }), handleVerifyResetOtp);
router.post('/reset-password', createRateLimiter({ key: 'reset-password', windowMs: 15 * 60 * 1000, max: 10 }), handleResetPassword);
router.post('/verify-invitation', createRateLimiter({ key: 'verify-invite', windowMs: 15 * 60 * 1000, max: 120 }), handleVerifyInvitation);
router.post('/register', createRateLimiter({ key: 'register', windowMs: 15 * 60 * 1000, max: 10 }), handleRegister);
router.post('/login', createRateLimiter({ key: 'login', windowMs: 15 * 60 * 1000, max: 10 }), handleLogin);
router.post('/invite', authenticate, requireCapability('MANAGE_USERS'), handleCreateInvitation);
router.get('/invitations', authenticate, requireCapability('MANAGE_USERS'), handleListInvitations);
router.post('/invitations/:id/revoke', authenticate, requireCapability('MANAGE_USERS'), handleRevokeInvitation);
router.get('/me', authenticate, handleGetMe);
router.put('/profile', authenticate, handleUpdateProfile);
router.get('/stream', authenticate, handleEventStream);
router.post('/logout', handleLogout);
router.get('/logout', handleLogout);

export default router;

import crypto from 'node:crypto';
import authService from '../services/authService.js';
import otpService from '../services/otpService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { registerClient } from '../utils/eventStream.js';

function setAuthCookies(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const sessionCookie = `worklog_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=${sameSite}${secure}`;
  const csrfCookie = `worklog_csrf_token=${encodeURIComponent(csrfToken)}; Path=/; Max-Age=86400; SameSite=${sameSite}${secure}`;
  res.setHeader('Set-Cookie', [sessionCookie, csrfCookie]);
  return csrfToken;
}

function clearAuthCookies(res) {
  const sameSite = process.env.NODE_ENV === 'production' ? 'None; Secure' : 'Lax';
  res.setHeader('Set-Cookie', [
    `worklog_session=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}`,
    `worklog_csrf_token=; Path=/; Max-Age=0; SameSite=${sameSite}`,
  ]);
}

export async function handleSendOtp(req, res, next) {
  try {
    const { email } = req.body;
    const result = await otpService.sendOtp(email);
    return sendSuccess(res, result, 'Verification code sent to your email. Valid for 10 minutes.', 200);
  } catch (err) {
    next(err);
  }
}

export async function handleRegister(req, res, next) {
  try {
    const { name, email, password, otp, invitationToken } = req.body;
    const result = await authService.register({ name, email, password, otp, invitationToken });
    const csrfToken = setAuthCookies(res, result.token);
    result.csrfToken = csrfToken;
    return sendSuccess(res, result, 'Registration successful.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    const csrfToken = setAuthCookies(res, result.token);
    result.csrfToken = csrfToken;
    return sendSuccess(res, result, 'Login successful.', 200);
  } catch (err) {
    next(err);
  }
}

export async function handleCreateInvitation(req, res, next) {
  try {
    const { email, expiresInHours } = req.body;
    const invitation = await authService.createInvitation({
      email,
      invitedByUser: req.user,
      expiresInHours: expiresInHours ? Number(expiresInHours) : 72,
    });
    return sendSuccess(res, invitation, 'Invitation created successfully.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleListInvitations(req, res, next) {
  try {
    const invitations = await authService.getInvitations();
    return sendSuccess(res, { invitations }, 'Invitations retrieved successfully.', 200);
  } catch (err) {
    next(err);
  }
}

export async function handleVerifyInvitation(req, res, next) {
  try {
    const { token, expectedEmail } = req.body;
    if (!token) {
      return sendError(res, 'Invitation token is required.', 400, 'INVALID_INVITATION');
    }
    const verified = await authService.verifyInvitationToken(token, expectedEmail);
    return sendSuccess(
      res,
      {
        valid: true,
        email: verified.email,
        expiresAt: verified.exp ? new Date(verified.exp * 1000).toISOString() : null,
      },
      'Invitation token is valid.',
      200
    );
  } catch (err) {
    return sendError(res, err.message, err.statusCode || 400, err.code || 'INVALID_INVITATION');
  }
}

export async function handleRevokeInvitation(req, res, next) {
  try {
    const { id } = req.params;
    const revoked = await authService.revokeInvitation(id, req.user);
    return sendSuccess(res, revoked, 'Invitation link has been revoked and expired.', 200);
  } catch (err) {
    next(err);
  }
}

export async function handleGetMe(req, res, next) {
  try {
    const result = await authService.getCurrentUser(req.user.id);
    return sendSuccess(res, result, 'User profile and capabilities retrieved.', 200);
  } catch (err) {
    next(err);
  }
}

export async function handleLogout(req, res, next) {
  try {
    clearAuthCookies(res);
    return sendSuccess(res, { loggedOut: true }, 'Successfully logged out.', 200);
  } catch (err) {
    next(err);
  }
}

export function handleEventStream(req, res) {
  const userId = req.user.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', userId })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  registerClient(userId, res);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
}

export default {
  handleSendOtp,
  handleRegister,
  handleLogin,
  handleCreateInvitation,
  handleListInvitations,
  handleVerifyInvitation,
  handleRevokeInvitation,
  handleGetMe,
  handleLogout,
  handleEventStream,
};

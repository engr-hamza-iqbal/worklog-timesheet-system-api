import jwt from 'jsonwebtoken';
import authService from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { JWT_SECRET } from '../config/env.js';
import { registerClient } from '../utils/eventStream.js';

export async function handleRegister(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const result = await authService.register({ name, email, password });
    return sendSuccess(res, result, 'Registration successful.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    return sendSuccess(res, result, 'Login successful.', 200);
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
    return sendSuccess(res, { loggedOut: true }, 'Successfully logged out.', 200);
  } catch (err) {
    next(err);
  }
}

export function handleEventStream(req, res) {
  const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Token required for event stream.' });
  }

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return res.status(401).json({ error: 'Invalid token for event stream.' });
  }

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
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
  handleEventStream,
};

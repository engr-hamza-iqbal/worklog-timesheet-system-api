import authService from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { registerClient } from '../utils/eventStream.js';

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const sameSite = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', `worklog_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=86400; SameSite=${sameSite}${secure}`);
}

function clearSessionCookie(res) {
  const sameSite = process.env.NODE_ENV === 'production' ? 'None; Secure' : 'Lax';
  res.setHeader('Set-Cookie', `worklog_session=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}`);
}

export async function handleRegister(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const result = await authService.register({ name, email, password });
    setSessionCookie(res, result.token);
    return sendSuccess(res, result, 'Registration successful.', 201);
  } catch (err) {
    next(err);
  }
}

export async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });
    setSessionCookie(res, result.token);
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
    clearSessionCookie(res);
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
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
  handleEventStream,
};

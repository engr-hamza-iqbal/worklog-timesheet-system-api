import authService from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';

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

export default {
  handleRegister,
  handleLogin,
  handleGetMe,
  handleLogout,
};

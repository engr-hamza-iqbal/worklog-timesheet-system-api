import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { ALLOW_PUBLIC_REGISTRATION, REGISTRATION_ALLOWED_DOMAINS, JWT_SECRET, JWT_EXPIRES_IN } from '../config/env.js';
import { getUserActiveCapabilities } from './accessService.js';
import otpService from './otpService.js';
import invitationStore from './invitationStore.js';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONSUMED_TOKENS_FILE = path.join(DATA_DIR, 'consumed_invitations.json');
const CWD_CONSUMED_TOKENS_FILE = path.resolve(process.cwd(), 'data/consumed_invitations.json');

// Consumed invitation tokens ledger (persisted to disk + in-memory Set)
const consumedTokens = new Set();

function initConsumedTokens() {
  try {
    const loadTokens = (filePath) => {
      if (fs.existsSync(filePath)) {
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (Array.isArray(data)) {
            data.forEach((id) => consumedTokens.add(id));
          }
        } catch {
          // ignore
        }
      }
    };

    loadTokens(CONSUMED_TOKENS_FILE);
    if (CWD_CONSUMED_TOKENS_FILE !== CONSUMED_TOKENS_FILE) {
      loadTokens(CWD_CONSUMED_TOKENS_FILE);
    }
  } catch {
    // fallback to in-memory set
  }
}
initConsumedTokens();

export function isInvitationConsumed(rawToken) {
  const token = cleanInvitationToken(rawToken);
  if (!token) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  if (consumedTokens.has(hash)) return true;
  try {
    const decoded = jwt.decode(token);
    if (decoded?.jti && consumedTokens.has(decoded.jti)) return true;
  } catch {
    // ignore
  }
  return false;
}

export function consumeInvitationToken(rawToken) {
  const token = cleanInvitationToken(rawToken);
  if (!token) return;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  consumedTokens.add(hash);
  try {
    const decoded = jwt.decode(token);
    if (decoded?.jti) {
      consumedTokens.add(decoded.jti);
    }
  } catch {
    // ignore
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONSUMED_TOKENS_FILE, JSON.stringify([...consumedTokens]), 'utf8');
  } catch {
    // ignore filesystem write errors, memory set is active
  }
}

export function clearConsumedInvitations() {
  consumedTokens.clear();
  try {
    if (fs.existsSync(CONSUMED_TOKENS_FILE)) {
      fs.unlinkSync(CONSUMED_TOKENS_FILE);
    }
  } catch {
    // ignore
  }
}

export function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      accountType: user.accountType,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function cleanInvitationToken(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (
    trimmed.includes('invite=') ||
    trimmed.includes('token=') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('?')
  ) {
    try {
      const parsedUrl = new URL(trimmed, 'http://localhost');
      const param = parsedUrl.searchParams.get('invite') || parsedUrl.searchParams.get('token');
      if (param) return param.trim();
      if (parsedUrl.hash) {
        const hashMatch = parsedUrl.hash.match(/[#?&](?:invite|token)=([^&#\s]+)/);
        if (hashMatch) return decodeURIComponent(hashMatch[1]).trim();
      }
    } catch {
      // fallback regex below
    }
    const match = trimmed.match(/[?&#](?:invite|token)=([^&#\s]+)/);
    if (match) return decodeURIComponent(match[1]).trim();
  }
  return trimmed;
}

export async function createInvitation({ email, invitedByUser, expiresInHours = 72 }) {
  if (!email || !email.trim()) {
    const error = new Error('Email is required for invitation.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  // Disallow generating invitation for an already registered user
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (existingUser) {
    const error = new Error(`User with email "${normalizedEmail}" is already registered.`);
    error.statusCode = 409;
    error.code = 'USER_ALREADY_EXISTS';
    throw error;
  }

  // Revoke previous pending invitations for this email so only the newest link is valid
  invitationStore.revokeByEmail(normalizedEmail, invitedByUser);

  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      email: normalizedEmail,
      invitedBy: invitedByUser.id,
      purpose: 'REGISTRATION_INVITATION',
      jti,
    },
    JWT_SECRET,
    { expiresIn: `${expiresInHours}h` }
  );

  const id = `inv_${crypto.randomBytes(8).toString('hex')}`;
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  invitationStore.addInvitation({
    id,
    email: normalizedEmail,
    token,
    jti,
    invitedBy: invitedByUser,
    expiresInHours,
    expiresAt,
    createdAt,
  });

  return {
    id,
    invitationToken: token,
    email: normalizedEmail,
    expiresInHours,
    expiresAt,
    createdAt,
    status: 'PENDING',
  };
}

export async function verifyInvitationToken(token, expectedEmail = null) {
  const cleaned = cleanInvitationToken(token);
  if (!cleaned) {
    const error = new Error('Invitation token is required.');
    error.statusCode = 400;
    error.code = 'INVALID_INVITATION';
    throw error;
  }

  if (invitationStore.isRevoked(cleaned)) {
    const error = new Error('This invitation link has been revoked by an administrator and is expired.');
    error.statusCode = 403;
    error.code = 'INVITATION_REVOKED';
    throw error;
  }

  if (isInvitationConsumed(cleaned)) {
    const error = new Error('This invitation token has already been used and is expired.');
    error.statusCode = 400;
    error.code = 'INVITATION_ALREADY_USED';
    throw error;
  }

  try {
    const decoded = jwt.verify(cleaned, JWT_SECRET);
    if (decoded.purpose !== 'REGISTRATION_INVITATION') {
      const error = new Error('Invalid invitation token.');
      error.statusCode = 400;
      error.code = 'INVALID_INVITATION';
      throw error;
    }
    if (decoded.jti && (consumedTokens.has(decoded.jti) || invitationStore.isRevoked(decoded.jti))) {
      const error = new Error('This invitation link has been revoked or expired.');
      error.statusCode = 403;
      error.code = 'INVITATION_REVOKED';
      throw error;
    }
    if (expectedEmail && decoded.email !== expectedEmail.trim().toLowerCase()) {
      const error = new Error('Invitation token does not match this email address.');
      error.statusCode = 403;
      error.code = 'INVITATION_EMAIL_MISMATCH';
      throw error;
    }
    if (decoded.email) {
      const existing = await prisma.user.findUnique({ where: { email: decoded.email.trim().toLowerCase() } });
      if (existing) {
        const error = new Error('A user with this email address has already been registered.');
        error.statusCode = 409;
        error.code = 'USER_ALREADY_EXISTS';
        throw error;
      }
    }
    return decoded;
  } catch (err) {
    if (err.statusCode) throw err;
    const error = new Error(err.name === 'TokenExpiredError' ? 'Invitation token has expired.' : 'Invalid invitation token.');
    error.statusCode = 400;
    error.code = err.name === 'TokenExpiredError' ? 'INVITATION_EXPIRED' : 'INVALID_INVITATION';
    throw error;
  }
}

export async function getInvitations() {
  return invitationStore.getAllInvitations(consumedTokens);
}

export async function revokeInvitation(id, revokingUser) {
  const revoked = invitationStore.revokeInvitation(id, revokingUser);
  if (revoked?.token) {
    consumeInvitationToken(revoked.token);
  }
  return revoked;
}

export async function register({ name, email, password, otp, invitationToken }) {
  if (!name || !name.trim()) {
    const error = new Error('Name is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email ? email.trim().toLowerCase() : '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    const error = new Error('A valid email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (!password || password.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    const missing = [];
    if (!hasUpper) missing.push('an uppercase letter');
    if (!hasLower) missing.push('a lowercase letter');
    if (!hasDigit) missing.push('a number');
    if (!hasSpecial) missing.push('a special character');
    const error = new Error(`Password is too weak. It must contain ${missing.join(', ')}.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  const cleanedToken = cleanInvitationToken(invitationToken);
  let invitation = null;
  if (cleanedToken) {
    invitation = await verifyInvitationToken(cleanedToken, normalizedEmail);
  }

  // Email verification:
  // If the user has a valid invitation from an admin, or is the first user,
  // email verification via OTP code is waived because the email was already authenticated.
  // Otherwise, public self-registration requires the 10-minute OTP code.
  if (!invitation && !isFirstUser) {
    if (!otp) {
      const error = new Error('Email verification code is required.');
      error.statusCode = 400;
      error.code = 'OTP_REQUIRED';
      throw error;
    }
    otpService.consumeOtp(normalizedEmail, otp);
  }

  if (!isFirstUser && !invitation) {
    if (!ALLOW_PUBLIC_REGISTRATION) {
      const error = new Error('Public registration is disabled. Request an invitation from an administrator.');
      error.statusCode = 403;
      error.code = 'REGISTRATION_DISABLED';
      throw error;
    }

    if (REGISTRATION_ALLOWED_DOMAINS.length > 0) {
      const domain = normalizedEmail.split('@')[1];
      if (!domain || !REGISTRATION_ALLOWED_DOMAINS.includes(domain)) {
        const error = new Error(`Registration is restricted to authorized email domains: ${REGISTRATION_ALLOWED_DOMAINS.join(', ')}`);
        error.statusCode = 403;
        error.code = 'DOMAIN_NOT_ALLOWED';
        throw error;
      }
    }
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    if (cleanedToken) {
      consumeInvitationToken(cleanedToken);
    }
    const error = new Error('An account with this email address already exists. The invitation is no longer valid.');
    error.statusCode = 409;
    error.code = 'EMAIL_ALREADY_EXISTS';
    throw error;
  }

  // If system has 0 users, first user becomes initial ADMIN; otherwise EMPLOYEE
  const accountType = isFirstUser ? 'ADMIN' : 'EMPLOYEE';

  const passwordHash = await bcrypt.hash(password, 10);

  const newUser = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      accountType,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      createdAt: true,
    },
  });

  // Permanently consume and expire the invitation token so it can never be used again
  if (cleanedToken) {
    consumeInvitationToken(cleanedToken);
    invitationStore.markAccepted(cleanedToken);
  }

  const token = generateToken(newUser);
  const capabilities = await getUserActiveCapabilities(newUser);

  return {
    user: newUser,
    token,
    capabilities,
  };
}

export async function login({ email, password }) {
  const normalizedEmail = email ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    const error = new Error('Both email and password are required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('This account has been deactivated. Please contact an administrator.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    accountType: user.accountType,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };

  const token = generateToken(safeUser);
  const capabilities = await getUserActiveCapabilities(safeUser);

  return {
    user: safeUser,
    token,
    capabilities,
  };
}

export async function getCurrentUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('This account has been deactivated.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  const capabilities = await getUserActiveCapabilities(user);

  return {
    user,
    capabilities,
  };
}

export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string' || password.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    const missing = [];
    if (!hasUpper) missing.push('an uppercase letter');
    if (!hasLower) missing.push('a lowercase letter');
    if (!hasDigit) missing.push('a number');
    if (!hasSpecial) missing.push('a special character');
    const error = new Error(`Password is too weak. It must contain ${missing.join(', ')}.`);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

/**
 * Reset password using either current password OR OTP code sent to registered email
 */
export async function resetPassword({ email, mode, otp, oldPassword, newPassword }) {
  if (!email || !email.trim()) {
    const error = new Error('Email address is required.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();

  validatePasswordStrength(newPassword);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    const error = new Error('No account found with this email address.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  if (!user.isActive) {
    const error = new Error('This account has been deactivated. Please contact an administrator.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_DEACTIVATED';
    throw error;
  }

  // Verification mode: either via oldPassword or via OTP code
  const isOldPassword = mode === 'oldPassword' || (oldPassword && !otp);
  const isOtp = mode === 'otp' || Boolean(otp);

  if (isOldPassword) {
    if (!oldPassword) {
      const error = new Error('Current (old) password is required.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      const error = new Error('Current password does not match our records.');
      error.statusCode = 400;
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }
  } else if (isOtp) {
    if (!otp) {
      const error = new Error('Verification code (OTP) is required.');
      error.statusCode = 400;
      error.code = 'OTP_REQUIRED';
      throw error;
    }
    otpService.consumePasswordResetOtp(normalizedEmail, otp);
  } else {
    const error = new Error('Please provide either your current password or an email verification code (OTP).');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  // Prevent setting identical password
  const isSame = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSame) {
    const error = new Error('New password must be different from your current password.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return {
    success: true,
    message: 'Your password has been successfully reset. You can now log in with your new password.',
  };
}

/**
 * Update authenticated user's profile and optionally change password with current password verification
 */
export async function updateProfile(userId, { name, mode, otp, oldPassword, newPassword }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.isActive) {
    const error = new Error('User not found or account inactive.');
    error.statusCode = 404;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  const data = {};

  if (name !== undefined) {
    if (!name || !name.trim() || name.trim().length < 2) {
      const error = new Error('Name must be at least 2 characters.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    data.name = name.trim();
  }

  if (newPassword) {
    validatePasswordStrength(newPassword);

    const isOtp = mode === 'otp' || Boolean(otp);
    if (isOtp) {
      if (!otp) {
        const error = new Error('Verification code (OTP) is required.');
        error.statusCode = 400;
        error.code = 'OTP_REQUIRED';
        throw error;
      }
      otpService.consumePasswordResetOtp(user.email, otp);
    } else {
      if (!oldPassword) {
        const error = new Error('Current password is required to change password.');
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
      }

      const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
      if (!isMatch) {
        const error = new Error('Current password is incorrect.');
        error.statusCode = 400;
        error.code = 'INVALID_CREDENTIALS';
        throw error;
      }
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      const error = new Error('New password must be different from your current password.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    data.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  if (Object.keys(data).length === 0) {
    const error = new Error('No profile changes provided.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      isActive: true,
      createdAt: true,
    },
  });

  const capabilities = await getUserActiveCapabilities(updatedUser);

  return {
    user: updatedUser,
    capabilities,
  };
}

export default {
  generateToken,
  cleanInvitationToken,
  createInvitation,
  verifyInvitationToken,
  isInvitationConsumed,
  consumeInvitationToken,
  clearConsumedInvitations,
  getInvitations,
  revokeInvitation,
  register,
  login,
  getCurrentUser,
  resetPassword,
  updateProfile,
  validatePasswordStrength,
};

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

// Consumed invitation tokens ledger (persisted to disk + in-memory Set)
const consumedTokens = new Set();
const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONSUMED_TOKENS_FILE = path.join(DATA_DIR, 'consumed_invitations.json');

function initConsumedTokens() {
  try {
    if (fs.existsSync(CONSUMED_TOKENS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONSUMED_TOKENS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach((id) => consumedTokens.add(id));
      }
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

export function verifyInvitationToken(token, expectedEmail = null) {
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
    invitation = verifyInvitationToken(cleanedToken, normalizedEmail);
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
};

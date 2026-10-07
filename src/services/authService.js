import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import { ALLOW_PUBLIC_REGISTRATION, REGISTRATION_ALLOWED_DOMAINS, JWT_SECRET, JWT_EXPIRES_IN } from '../config/env.js';
import { getUserActiveCapabilities } from './accessService.js';
import otpService from './otpService.js';

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

export function createInvitation({ email, invitedByUser, expiresInHours = 72 }) {
  if (!email || !email.trim()) {
    const error = new Error('Email is required for invitation.');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const token = jwt.sign(
    {
      email: normalizedEmail,
      invitedBy: invitedByUser.id,
      purpose: 'REGISTRATION_INVITATION',
    },
    JWT_SECRET,
    { expiresIn: `${expiresInHours}h` }
  );
  return {
    invitationToken: token,
    email: normalizedEmail,
    expiresInHours,
    expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString(),
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
  try {
    const decoded = jwt.verify(cleaned, JWT_SECRET);
    if (decoded.purpose !== 'REGISTRATION_INVITATION') {
      const error = new Error('Invalid invitation token.');
      error.statusCode = 400;
      error.code = 'INVALID_INVITATION';
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
    const error = new Error('An account with this email address already exists.');
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
  createInvitation,
  verifyInvitationToken,
  register,
  login,
  getCurrentUser,
};

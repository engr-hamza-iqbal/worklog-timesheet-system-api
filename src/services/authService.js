const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { getUserActiveCapabilities } = require('./accessService');

function generateToken(user) {
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

async function register({ name, email, password }) {
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

  // Check if email already registered
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
  const userCount = await prisma.user.count();
  const accountType = userCount === 0 ? 'ADMIN' : 'EMPLOYEE';

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

async function login({ email, password }) {
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

async function getCurrentUser(userId) {
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

module.exports = {
  register,
  login,
  getCurrentUser,
};

import dns from 'node:dns';

// Render and Docker containers frequently lack outbound IPv6 routing.
// Prioritizing IPv4 prevents ENETUNREACH errors when resolving Gmail SMTP and external hosts.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

import app from './app.js';
import { PORT } from './config/env.js';
import prisma from './config/db.js';

const server = app.listen(PORT, () => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
  }
  console.log(`Server started in ${process.env.NODE_ENV} mode.`);
});

// Process-level resilience: catch unhandled promise rejections without crashing the container
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Fatal Guard] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Catch uncaught synchronous exceptions, log diagnostics, and attempt graceful teardown
process.on('uncaughtException', async (error) => {
  console.error('[Process Fatal Guard] Uncaught Exception:', error);
  try {
    if (server?.listening) {
      server.close();
    }
    await prisma.$disconnect();
  } catch (teardownErr) {
    console.error('Error during emergency teardown:', teardownErr);
  } finally {
    process.exit(1);
  }
});

// Graceful termination signals (Render, Docker, Kubernetes)
const handleGracefulShutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (server?.listening) {
    server.close(async () => {
      console.log('HTTP server closed.');
      try {
        await prisma.$disconnect();
        console.log('Database connections cleanly terminated.');
      } catch (dbErr) {
        console.error('Error disconnecting database:', dbErr);
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));


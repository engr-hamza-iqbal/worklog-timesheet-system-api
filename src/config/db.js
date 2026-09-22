import { PrismaClient } from '@prisma/client';

// Supabase Transaction Mode (PgBouncer) — only log warnings/errors to avoid
// console overhead from query logs, which added measurable latency in development.
const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

export default prisma;

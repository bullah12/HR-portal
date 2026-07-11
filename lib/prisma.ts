/**
 * Prisma client singleton — all database access goes through this instance.
 * Cached on globalThis so Next.js hot reloads don't exhaust the connection pool.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

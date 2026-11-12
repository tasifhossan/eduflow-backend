import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Runs a Prisma interactive transaction and logs its duration under a named label
 * when LOG_TX_METRICS=true.
 */
export async function runTimedTransaction<T>(
  label: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number }
): Promise<T> {
  const start = performance.now();
  try {
    return await prisma.$transaction(fn, options);
  } finally {
    const durationMs = Number((performance.now() - start).toFixed(2));
    if (process.env.LOG_TX_METRICS === 'true') {
      console.log(`[TX:${label}] ${durationMs}ms`);
    }
  }
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
});

export default prisma;

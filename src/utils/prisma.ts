import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    transactionOptions: {
      maxWait: 10000,
      timeout: 30000,
    },
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
});

export default prisma;

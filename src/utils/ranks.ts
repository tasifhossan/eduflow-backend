import { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * Persists student ranks for a test in ONE update query using standard SQL RANK() OVER (ORDER BY score DESC).
 * Ties share a rank (competition ranking, e.g. 1, 1, 3).
 * Serialized under a PostgreSQL transaction advisory lock (pg_advisory_xact_lock).
 * The (r.rank IS DISTINCT FROM sub.new_rank) condition ensures rows are touched only when rank changed.
 */
export async function recomputeRanks(
  testId: string,
  txClient?: Prisma.TransactionClient
): Promise<number> {
  const runner = async (tx: Prisma.TransactionClient) => {
    // 1. Transaction-level advisory lock on hashed testId key
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'test_rank_' + testId}))`;

    // 2. Perform one single atomic update with competition ranking
    const updatedCount = await tx.$executeRaw`
      UPDATE "Result" r
      SET rank = sub.new_rank
      FROM (
        SELECT id, RANK() OVER (ORDER BY "totalMarksObtained" DESC) as new_rank
        FROM "Result"
        WHERE "testId" = ${testId}
      ) sub
      WHERE r.id = sub.id AND (r.rank IS DISTINCT FROM sub.new_rank)
    `;

    return updatedCount;
  };

  if (txClient) {
    return runner(txClient);
  }

  return prisma.$transaction(runner);
}


import { PrismaClient } from '@prisma/client';

export interface ChapterWeakSpot {
  chapterId: string;
  chapterName: string;
  averageScore: number | null;
  averagePercentage: number | null;
  resultCount: number;
}

/**
 * Calculates chapter-wise weak spot breakdown for a batch (or filtered by studentId).
 * Tests without chapterId or results are ignored.
 * Returns array sorted weakest-first (lowest averagePercentage first).
 */
export async function getBatchChapterWeakSpots(
  prisma: PrismaClient,
  batchId: string,
  studentId?: string
): Promise<ChapterWeakSpot[]> {
  const tests = await prisma.test.findMany({
    where: { batchId },
    include: {
      chapter: { select: { id: true, name: true } },
      results: {
        where: studentId ? { studentId } : undefined,
        select: { totalMarksObtained: true },
      },
    },
  });

  const chapterMap = new Map<
    string,
    { chapterId: string; chapterName: string; scores: number[]; totalMarksList: number[] }
  >();

  for (const test of tests) {
    if (!test.chapterId || !test.chapter) continue;
    if (!chapterMap.has(test.chapterId)) {
      chapterMap.set(test.chapterId, {
        chapterId: test.chapterId,
        chapterName: test.chapter.name,
        scores: [],
        totalMarksList: [],
      });
    }
    const entry = chapterMap.get(test.chapterId)!;
    for (const result of test.results) {
      entry.scores.push(result.totalMarksObtained);
      entry.totalMarksList.push(test.totalMarks);
    }
  }

  return Array.from(chapterMap.values())
    .map((c) => {
      const avgScore =
        c.scores.length > 0 ? c.scores.reduce((a, b) => a + b, 0) / c.scores.length : null;
      const avgTotal =
        c.totalMarksList.length > 0
          ? c.totalMarksList.reduce((a, b) => a + b, 0) / c.totalMarksList.length
          : null;
      const avgPercentage =
        avgScore !== null && avgTotal !== null && avgTotal > 0
          ? parseFloat(((avgScore / avgTotal) * 100).toFixed(2))
          : null;
      return {
        chapterId: c.chapterId,
        chapterName: c.chapterName,
        averageScore: avgScore !== null ? parseFloat(avgScore.toFixed(2)) : null,
        averagePercentage: avgPercentage,
        resultCount: c.scores.length,
      };
    })
    .sort((a, b) => {
      if (a.averagePercentage === null) return 1;
      if (b.averagePercentage === null) return -1;
      return a.averagePercentage - b.averagePercentage;
    });
}

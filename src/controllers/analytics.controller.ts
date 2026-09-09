import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

// GET /api/batches/:batchId/analytics
// ADMIN / TEACHER only — scoped to caller's branchId
export async function getBatchAnalytics(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const batchId = req.params.batchId as string;

    const batchWhere: any = { id: batchId };
    if (req.effectiveBranchId) {
      batchWhere.branchId = req.effectiveBranchId;
    }

    const batch = await prisma.batch.findFirst({
      where: batchWhere,
      select: { id: true, name: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found or access denied' });
    }

    // Fetch all tests in this batch with their results and chapter info
    const tests = await prisma.test.findMany({
      where: { batchId },
      include: {
        chapter: { select: { id: true, name: true } },
        results: { select: { totalMarksObtained: true } },
      },
      orderBy: { testDate: 'asc' },
    });

    if (tests.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No tests found in this batch',
        data: {
          batchId: batch.id,
          batchName: batch.name,
          overallAverage: null,
          perTestBreakdown: [],
          chapterWeakSpots: [],
        },
      });
    }

    // --- Per-test breakdown ---
    const perTestBreakdown = tests.map((test) => {
      const scores = test.results.map((r) => r.totalMarksObtained);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      const max = scores.length > 0 ? Math.max(...scores) : null;
      const min = scores.length > 0 ? Math.min(...scores) : null;
      return {
        testId: test.id,
        testName: test.title,
        testDate: test.testDate,
        totalMarks: test.totalMarks,
        resultCount: scores.length,
        average: avg !== null ? parseFloat(avg.toFixed(2)) : null,
        max,
        min,
      };
    });

    // --- Overall average (across all results in the batch) ---
    const allScores = tests.flatMap((t) => t.results.map((r) => r.totalMarksObtained));
    const overallAverage =
      allScores.length > 0
        ? parseFloat((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
        : null;

    // --- Chapter-wise weak-spot breakdown ---
    // Group tests by chapter; compute avg percentage score per chapter (in-memory)
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

    // Compute average percentage per chapter, sort weakest first
    const chapterWeakSpots = Array.from(chapterMap.values())
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
      // Sort weakest-first (null percentages go last)
      .sort((a, b) => {
        if (a.averagePercentage === null) return 1;
        if (b.averagePercentage === null) return -1;
        return a.averagePercentage - b.averagePercentage;
      });

    return res.status(200).json({
      success: true,
      message: 'Batch analytics retrieved successfully',
      data: {
        batchId: batch.id,
        batchName: batch.name,
        overallAverage,
        perTestBreakdown,
        chapterWeakSpots,
      },
    });
  } catch (error) {
    console.error('Get batch analytics error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// GET /api/batches/:batchId/students/:studentId/trend
// ADMIN/TEACHER: any student in their branch's batch
// STUDENT: only their own (403 otherwise)
export async function getStudentTrend(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Authentication required' });
    }

    const batchId = req.params.batchId as string;
    const studentId = req.params.studentId as string;
    const { role, userId, branchId } = req.user;

    // STUDENT can only view their own trend
    if (role === Role.STUDENT && userId !== studentId) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only view your own trend' });
    }

    const batchWhere: any = { id: batchId };
    if (req.effectiveBranchId) {
      batchWhere.branchId = req.effectiveBranchId;
    }

    const batch = await prisma.batch.findFirst({
      where: batchWhere,
      select: { id: true, name: true },
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found or access denied' });
    }

    // Verify the student is (or was) enrolled in this batch
    const enrollment = await prisma.enrollment.findUnique({
      where: { studentId_batchId: { studentId, batchId } },
    });

    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this batch' });
    }

    // Fetch chronological results for this student in this batch
    const results = await prisma.result.findMany({
      where: {
        studentId,
        test: { batchId },
      },
      include: {
        test: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            testDate: true,
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });

    const trend = results.map((r) => ({
      testId: r.test.id,
      testName: r.test.title,
      testDate: r.test.testDate,
      submittedAt: r.submittedAt,
      totalMarks: r.test.totalMarks,
      score: r.totalMarksObtained,
      percentage:
        r.test.totalMarks > 0
          ? parseFloat(((r.totalMarksObtained / r.test.totalMarks) * 100).toFixed(2))
          : null,
      rank: r.rank,
    }));

    return res.status(200).json({
      success: true,
      message: 'Student trend retrieved successfully',
      data: {
        batchId: batch.id,
        batchName: batch.name,
        studentId,
        trend,
      },
    });
  } catch (error) {
    console.error('Get student trend error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

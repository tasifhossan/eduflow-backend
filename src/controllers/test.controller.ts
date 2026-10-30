import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { createTestSchema, updateTestSchema } from '../validators/test.validator';
import { createAuditLog } from '../utils/audit';
import { shuffleArray } from '../utils/shuffle';

export async function createTest(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const parseResult = createTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      title,
      type,
      batchId,
      chapterId,
      totalMarks,
      negativeMarkingValue,
      durationMinutes,
      testDate,
      windowEndsAt,
      shuffleQuestions,
      shuffleOptions,
    } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch belongs to branch and is not archived
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId || batch.archivedAt !== null) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found, archived, or access denied',
      });
    }

    // Verify chapter exists (if provided)
    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapter) {
        return res.status(404).json({
          success: false,
          message: 'Chapter not found',
        });
      }
    }

    const test = await prisma.test.create({
      data: {
        title,
        type,
        batchId,
        chapterId: chapterId || null,
        totalMarks,
        negativeMarkingValue,
        durationMinutes: durationMinutes || null,
        testDate: new Date(testDate),
        windowEndsAt: windowEndsAt ? new Date(windowEndsAt) : null,
        shuffleQuestions: !!shuffleQuestions,
        shuffleOptions: !!shuffleOptions,
        createdById: req.user.userId,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Test created successfully',
      data: test,
    });
  } catch (error) {
    console.error('Create test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getTestsByBatch(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const batchId = req.params.batchId as string;
    const branchId = req.user.branchId;

    // Verify batch belongs to branch and is not archived
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId || batch.archivedAt !== null) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    // SEC-09: STUDENT access requires an ACTIVE enrollment in that batch; otherwise 403.
    if (req.user.role === Role.STUDENT) {
      const activeEnrollment = await prisma.enrollment.findFirst({
        where: {
          studentId: req.user.userId,
          batchId,
          status: 'ACTIVE',
        },
      });
      if (!activeEnrollment) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Active enrollment required',
        });
      }
    }

    // Filter out archived tests
    const tests = await prisma.test.findMany({
      where: {
        batchId,
        archivedAt: null,
      },
      orderBy: { testDate: 'asc' },
    });

    return res.status(200).json({
      success: true,
      message: 'Tests retrieved successfully',
      data: tests,
    });
  } catch (error) {
    console.error('Get tests by batch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getTestById(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const test = await prisma.test.findUnique({
      where: { id },
      include: {
        batch: { select: { branchId: true, archivedAt: true } },
        questions: {
          orderBy: { order: 'asc' },
          include: {
            options: {
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });

    if (!test || test.batch.branchId !== branchId || test.archivedAt !== null || test.batch.archivedAt !== null) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // SEC-09: STUDENT access requires an ACTIVE enrollment in that batch; otherwise 403.
    if (req.user.role === Role.STUDENT) {
      const activeEnrollment = await prisma.enrollment.findFirst({
        where: {
          studentId: req.user.userId,
          batchId: test.batchId,
          status: 'ACTIVE',
        },
      });
      if (!activeEnrollment) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Active enrollment required',
        });
      }
    }

    // Exclude batch property from response data
    const { batch, ...testData } = test;

    // Student view rules
    if (req.user.role === Role.STUDENT) {
      const now = new Date();
      const testDate = new Date(test.testDate);
      const windowEnd = test.windowEndsAt
        ? new Date(test.windowEndsAt)
        : test.durationMinutes
        ? new Date(testDate.getTime() + test.durationMinutes * 60 * 1000)
        : testDate;

      // Check if student has an existing attempt
      const attempt = await prisma.testAttempt.findUnique({
        where: {
          testId_studentId: {
            testId: id,
            studentId: req.user.userId,
          },
        },
      });

      // Until an attempt exists, return metadata only (no questions)
      if (!attempt) {
        return res.status(200).json({
          success: true,
          message: 'Test metadata retrieved successfully',
          data: {
            ...testData,
            questions: [],
          },
        });
      }

      // If an attempt exists:
      let questionsList = [...testData.questions];

      // Deterministic question shuffling if flag enabled
      if (test.shuffleQuestions && attempt.seed) {
        questionsList = shuffleArray(questionsList, attempt.seed + ':questions');
      }

      // Option formatting / shuffling
      const isWindowClosed = now > windowEnd;

      questionsList = questionsList.map((q) => {
        let options = [...q.options];
        if (test.shuffleOptions && attempt.seed) {
          options = shuffleArray(options, attempt.seed + ':options:' + q.id);
        }

        // Before window close for everyone, strip isCorrect
        if (!isWindowClosed) {
          options = options.map((o) => {
            const { isCorrect, ...rest } = o;
            return rest as any;
          });
        }

        return {
          ...q,
          options,
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Test retrieved successfully',
        data: {
          ...testData,
          questions: questionsList,
        },
      });
    }

    // Staff caller (ADMIN / TEACHER / SUPER_ADMIN) gets full questions and options
    return res.status(200).json({
      success: true,
      message: 'Test retrieved successfully',
      data: testData,
    });
  } catch (error) {
    console.error('Get test by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateTest(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const existingTest = await prisma.test.findUnique({
      where: { id },
      include: { batch: { select: { branchId: true } } },
    });

    if (!existingTest || existingTest.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    const parseResult = updateTestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const {
      title,
      type,
      batchId,
      chapterId,
      totalMarks,
      negativeMarkingValue,
      durationMinutes,
      testDate,
      windowEndsAt,
      shuffleQuestions,
      shuffleOptions,
    } = parseResult.data;

    // Check if testDate or durationMinutes is changing
    const isTestDateChanging = testDate !== undefined && new Date(testDate).getTime() !== existingTest.testDate.getTime();
    const isDurationChanging = durationMinutes !== undefined && durationMinutes !== existingTest.durationMinutes;

    if (isTestDateChanging || isDurationChanging) {
      const [attemptsCount, resultsCount] = await Promise.all([
        prisma.testAttempt.count({ where: { testId: id } }),
        prisma.result.count({ where: { testId: id } }),
      ]);
      if (attemptsCount > 0 || resultsCount > 0) {
        await createAuditLog({
          actorId: req.user.userId,
          action: 'EXAM_LOCKED_ATTEMPT',
          entityType: 'Test',
          entityId: id,
          branchId,
          metadata: { attemptedAction: 'UPDATE_TEST_DATE_OR_DURATION' },
          ip: req.ip,
        });
        return res.status(409).json({
          success: false,
          code: 'EXAM_LOCKED',
          message: 'Test timing (testDate or durationMinutes) cannot be changed after student attempts or results already exist.',
        });
      }
    }

    // Verify new batch if changed
    if (batchId && batchId !== existingTest.batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
      });
      if (!batch || batch.branchId !== branchId || batch.archivedAt !== null) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found, archived, or access denied',
        });
      }
    }

    // Verify chapter if changed
    if (chapterId) {
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
      });
      if (!chapter) {
        return res.status(404).json({
          success: false,
          message: 'Chapter not found',
        });
      }
    }

    const updatedTest = await prisma.test.update({
      where: { id },
      data: {
        title,
        type,
        batchId,
        chapterId: chapterId !== undefined ? chapterId : undefined,
        totalMarks,
        negativeMarkingValue,
        durationMinutes: durationMinutes !== undefined ? durationMinutes : undefined,
        testDate: testDate ? new Date(testDate) : undefined,
        windowEndsAt: windowEndsAt !== undefined ? (windowEndsAt ? new Date(windowEndsAt) : null) : undefined,
        shuffleQuestions: shuffleQuestions !== undefined ? shuffleQuestions : undefined,
        shuffleOptions: shuffleOptions !== undefined ? shuffleOptions : undefined,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Test updated successfully',
      data: updatedTest,
    });
  } catch (error) {
    console.error('Update test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteTest(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const existingTest = await prisma.test.findUnique({
      where: { id },
      include: {
        batch: { select: { branchId: true } },
        attempts: { select: { id: true }, take: 1 },
        results: { select: { id: true }, take: 1 },
      },
    });

    if (!existingTest || existingTest.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // Archive instead of destructive delete if student activity exists
    const hasStudentActivity = existingTest.attempts.length > 0 || existingTest.results.length > 0;

    if (hasStudentActivity) {
      await prisma.test.update({
        where: { id },
        data: { archivedAt: new Date() },
      });

      await createAuditLog({
        actorId: req.user.userId,
        action: 'ARCHIVE_TEST',
        entityType: 'Test',
        entityId: id,
        branchId,
        metadata: {
          attemptsCount: existingTest.attempts.length,
          resultsCount: existingTest.results.length,
        },
        ip: req.ip,
      });

      return res.status(200).json({
        success: true,
        message: 'Test has existing attempts or results and was archived instead of deleted',
        data: { archived: true },
      });
    }

    // Truly empty test -> hard delete
    await prisma.test.delete({
      where: { id },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'DELETE_TEST',
      entityType: 'Test',
      entityId: id,
      branchId,
      metadata: { hardDeleted: true },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Test deleted successfully',
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Delete test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function restoreTest(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    const existingTest = await prisma.test.findUnique({
      where: { id },
      include: { batch: { select: { branchId: true } } },
    });

    if (!existingTest || existingTest.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    await prisma.test.update({
      where: { id },
      data: { archivedAt: null },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'RESTORE_TEST',
      entityType: 'Test',
      entityId: id,
      branchId,
      metadata: { restored: true },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Test restored successfully',
      data: { restored: true },
    });
  } catch (error) {
    console.error('Restore test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

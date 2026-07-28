import { Request, Response } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { createTestSchema, updateTestSchema } from '../validators/test.validator';

const prisma = new PrismaClient();

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

    const { title, type, batchId, chapterId, totalMarks, negativeMarkingValue, durationMinutes, testDate } = parseResult.data;
    const branchId = req.user.branchId;

    // Verify batch belongs to branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
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

    // Verify batch belongs to branch
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    if (!batch || batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found or access denied',
      });
    }

    const tests = await prisma.test.findMany({
      where: { batchId },
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
        batch: { select: { branchId: true } },
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

    if (!test || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // Exclude batch property from response data
    const { batch, ...testData } = test;

    // If student, check if they already submitted the test
    if (req.user.role === Role.STUDENT) {
      const submission = await prisma.result.findUnique({
        where: {
          studentId_testId: {
            studentId: req.user.userId,
            testId: id,
          },
        },
      });

      if (!submission) {
        // Exclude isCorrect from options
        testData.questions = testData.questions.map((q) => ({
          ...q,
          options: q.options.map((o) => {
            const { isCorrect, ...restOption } = o;
            return restOption;
          }) as any,
        }));
      }
    }

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

    const { title, type, batchId, chapterId, totalMarks, negativeMarkingValue, durationMinutes, testDate } = parseResult.data;

    // Verify new batch if changed
    if (batchId && batchId !== existingTest.batchId) {
      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
      });
      if (!batch || batch.branchId !== branchId) {
        return res.status(404).json({
          success: false,
          message: 'Batch not found or access denied',
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
      include: { batch: { select: { branchId: true } } },
    });

    if (!existingTest || existingTest.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    await prisma.test.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Test deleted successfully',
    });
  } catch (error) {
    console.error('Delete test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

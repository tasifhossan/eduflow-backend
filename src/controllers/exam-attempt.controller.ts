import { Request, Response } from 'express';
import crypto from 'crypto';
import { Role, QuestionType, AttemptStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { EXAM_CONFIG } from '../config/academics.config';
import { shuffleArray } from '../utils/shuffle';
import { recomputeRanks } from '../utils/ranks';
import { createAuditLog } from '../utils/audit';
import { saveAttemptAnswersSchema, extendAttemptSchema } from '../validators/test.validator';

/**
 * Shared helper to grade an attempt's answers and create a Result record
 * with status = EXPIRED. Must be executed in a transaction or caller can pass tx.
 */
async function finalizeExpiredAttemptInTx(
  tx: any,
  attempt: {
    id: string;
    testId: string;
    studentId: string;
  },
  test: {
    id: string;
    negativeMarkingValue: number;
    questions: Array<{
      id: string;
      type: QuestionType;
      marks: number;
      options: Array<{ id: string; isCorrect: boolean }>;
    }>;
  }
) {
  // 1. Fetch saved attempt answers
  const savedAnswers = await tx.attemptAnswer.findMany({
    where: { attemptId: attempt.id },
  });

  const answerMap = new Map<string, { optionId: string | null; textAnswer: string | null }>();
  for (const a of savedAnswers) {
    answerMap.set(a.questionId, { optionId: a.optionId, textAnswer: a.textAnswer });
  }

  let totalScore = 0;
  const now = new Date();

  // 2. Process each question
  for (const q of test.questions) {
    const studentAns = answerMap.get(q.id);
    let selectedOptionId: string | null = null;
    let writtenAnswerText: string | null = null;
    let marksAwarded: number | null = null;

    if (q.type === QuestionType.MCQ) {
      selectedOptionId = studentAns?.optionId || null;
      const correctOption = q.options.find((o) => o.isCorrect);

      if (!selectedOptionId) {
        marksAwarded = 0;
      } else if (correctOption && selectedOptionId === correctOption.id) {
        marksAwarded = q.marks;
      } else {
        marksAwarded = -test.negativeMarkingValue;
      }
      totalScore += marksAwarded;
    } else {
      writtenAnswerText = studentAns?.textAnswer || null;
      marksAwarded = null; // graded manually later
    }

    await tx.studentAnswer.create({
      data: {
        studentId: attempt.studentId,
        questionId: q.id,
        selectedOptionId,
        writtenAnswerText,
        marksAwarded,
      },
    });
  }

  // 3. Create Result
  const result = await tx.result.create({
    data: {
      studentId: attempt.studentId,
      testId: test.id,
      attemptId: attempt.id,
      totalMarksObtained: totalScore,
      submittedAt: now,
    },
  });

  // 4. Mark attempt EXPIRED
  await tx.testAttempt.update({
    where: { id: attempt.id },
    data: {
      status: AttemptStatus.EXPIRED,
      submittedAt: now,
    },
  });

  // 5. Recompute ranks
  await recomputeRanks(test.id, tx);

  return result;
}

/**
 * POST /api/tests/:id/start (STUDENT)
 * Idempotent: creates or returns the attempt; returns remaining time and questions
 * with isCorrect stripped and deterministic shuffling based on attempt seed.
 */
export async function startTestAttempt(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const studentId = req.user.userId;
    const branchId = req.user.branchId;

    // 1. Fetch test with batch and questions
    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        batch: { select: { branchId: true } },
        questions: {
          include: {
            options: {
              select: {
                id: true,
                text: true,
                isCorrect: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!test || test.archivedAt !== null || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found, archived, or access denied',
      });
    }

    // 2. Active enrollment check
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_batchId: {
          studentId,
          batchId: test.batchId,
        },
      },
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You must be actively enrolled in this batch to take this test',
      });
    }

    // 3. Existing Result check
    const existingResult = await prisma.result.findUnique({
      where: {
        studentId_testId: {
          studentId,
          testId,
        },
      },
    });

    if (existingResult) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'Test has already been submitted by this student',
      });
    }

    // 4. Timing window validation
    const now = new Date();
    const testDate = new Date(test.testDate);
    const windowEnd = test.windowEndsAt
      ? new Date(test.windowEndsAt)
      : test.durationMinutes
      ? new Date(testDate.getTime() + test.durationMinutes * 60 * 1000)
      : testDate;

    if (now < testDate) {
      return res.status(400).json({
        success: false,
        message: 'Test has not started yet',
      });
    }

    if (now >= windowEnd) {
      return res.status(400).json({
        success: false,
        message: 'Test window has closed',
      });
    }

    // 5. Existing attempt check (idempotency)
    let attempt = await prisma.testAttempt.findUnique({
      where: {
        testId_studentId: {
          testId,
          studentId,
        },
      },
    });

    if (!attempt) {
      // Calculate deadline: min(now + durationMinutes, windowEnd)
      let nominalDeadline = windowEnd;
      if (test.durationMinutes) {
        const durationDeadline = new Date(now.getTime() + test.durationMinutes * 60 * 1000);
        if (durationDeadline < nominalDeadline) {
          nominalDeadline = durationDeadline;
        }
      }

      const seed = crypto.randomBytes(16).toString('hex');

      attempt = await prisma.testAttempt.create({
        data: {
          testId,
          studentId,
          startedAt: now,
          deadlineAt: nominalDeadline,
          seed,
          status: AttemptStatus.IN_PROGRESS,
        },
      });
    } else if (attempt.status === AttemptStatus.SUBMITTED) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'Test has already been submitted by this student',
      });
    }

    // 6. Format and deterministically shuffle questions
    let questions = test.questions.map((q) => {
      let options = q.options.map((opt) => ({
        id: opt.id,
        text: opt.text,
      }));

      if (test.shuffleOptions && q.type === QuestionType.MCQ) {
        options = shuffleArray(options, `${attempt.seed}:options:${q.id}`);
      }

      return {
        id: q.id,
        text: q.text,
        type: q.type,
        marks: q.marks,
        order: q.order,
        options,
      };
    });

    if (test.shuffleQuestions) {
      questions = shuffleArray(questions, `${attempt.seed}:questions`);
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(attempt.deadlineAt).getTime() - Date.now()) / 1000)
    );

    return res.status(200).json({
      success: true,
      message: 'Test attempt started',
      data: {
        attempt: {
          id: attempt.id,
          startedAt: attempt.startedAt,
          deadlineAt: attempt.deadlineAt,
          serverNow: new Date(),
          remainingSeconds,
          status: attempt.status,
        },
        questions,
      },
    });
  } catch (error) {
    console.error('Start test attempt error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/tests/:id/attempt (STUDENT)
 * Returns current attempt state with saved answers and remaining time.
 * Performs lazy finalization if deadline + grace has passed and no Result exists.
 */
export async function getStudentAttempt(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const studentId = req.user.userId;

    let attempt = await prisma.testAttempt.findUnique({
      where: {
        testId_studentId: {
          testId,
          studentId,
        },
      },
      include: {
        answers: {
          select: {
            questionId: true,
            optionId: true,
            textAnswer: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'No attempt found for this test',
      });
    }

    const now = new Date();
    const graceCutoff = new Date(
      new Date(attempt.deadlineAt).getTime() + EXAM_CONFIG.SUBMISSION_GRACE_SECONDS * 1000
    );

    // Check if lazy finalization is needed (deadline + grace passed and still no Result)
    let result = await prisma.result.findUnique({
      where: {
        studentId_testId: {
          studentId,
          testId,
        },
      },
    });

    if (!result && now > graceCutoff) {
      const test = await prisma.test.findUnique({
        where: { id: testId },
        include: {
          questions: {
            include: { options: true },
          },
        },
      });

      if (test) {
        result = await prisma.$transaction(async (tx) => {
          return finalizeExpiredAttemptInTx(tx, attempt!, test);
        });

        await createAuditLog({
          actorId: studentId,
          action: 'LAZY_FINALIZE_ATTEMPT',
          entityType: 'TestAttempt',
          entityId: attempt.id,
          branchId: req.user.branchId,
          metadata: {
            testId,
            studentId,
            autoExpired: true,
          },
          ip: req.ip,
        });

        // Re-read updated attempt status
        attempt = await prisma.testAttempt.findUnique({
          where: { id: attempt.id },
          include: {
            answers: {
              select: {
                questionId: true,
                optionId: true,
                textAnswer: true,
                updatedAt: true,
              },
            },
          },
        });
      }
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(attempt!.deadlineAt).getTime() - Date.now()) / 1000)
    );

    return res.status(200).json({
      success: true,
      message: 'Attempt retrieved successfully',
      data: {
        attempt: {
          id: attempt!.id,
          status: attempt!.status,
          startedAt: attempt!.startedAt,
          deadlineAt: attempt!.deadlineAt,
          submittedAt: attempt!.submittedAt,
          extendedMinutes: attempt!.extendedMinutes,
          remainingSeconds,
          serverNow: new Date(),
        },
        savedAnswers: attempt!.answers,
        result: result
          ? {
              id: result.id,
              totalMarksObtained: result.totalMarksObtained,
              rank: result.rank,
              submittedAt: result.submittedAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Get student attempt error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * PUT /api/tests/:id/attempt/answers (STUDENT)
 * Upserts saved answers; rejected after deadline + 10s with code ATTEMPT_CLOSED.
 * Rate limit 120 per minute per user applied via middleware.
 */
export async function saveAttemptAnswers(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const studentId = req.user.userId;

    const parseResult = saveAttemptAnswersSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { answers } = parseResult.data;

    // 1. Fetch attempt
    const attempt = await prisma.testAttempt.findUnique({
      where: {
        testId_studentId: {
          testId,
          studentId,
        },
      },
    });

    if (!attempt || attempt.status !== AttemptStatus.IN_PROGRESS) {
      return res.status(400).json({
        success: false,
        code: 'ATTEMPT_CLOSED',
        message: 'Attempt is not in progress or does not exist',
      });
    }

    // 2. Check deadline + 10s autosave grace
    const now = new Date();
    const autosaveCutoff = new Date(
      new Date(attempt.deadlineAt).getTime() + EXAM_CONFIG.AUTOSAVE_GRACE_SECONDS * 1000
    );

    if (now > autosaveCutoff) {
      return res.status(400).json({
        success: false,
        code: 'ATTEMPT_CLOSED',
        message: 'Autosave window has expired',
      });
    }

    // 3. Validate questionId and optionId belong to this test
    const testQuestions = await prisma.question.findMany({
      where: { testId },
      include: {
        options: {
          select: { id: true },
        },
      },
    });

    const questionMap = new Map<string, Set<string>>();
    for (const q of testQuestions) {
      questionMap.set(q.id, new Set(q.options.map((o) => o.id)));
    }

    for (const ans of answers) {
      const validOptions = questionMap.get(ans.questionId);
      if (!validOptions) {
        return res.status(400).json({
          success: false,
          message: `Question ${ans.questionId} does not belong to this test`,
        });
      }
      if (ans.optionId && !validOptions.has(ans.optionId)) {
        return res.status(400).json({
          success: false,
          message: `Option ${ans.optionId} does not belong to question ${ans.questionId}`,
        });
      }
    }

    // 4. Upsert answers inside a transaction
    await prisma.$transaction(
      answers.map((ans) =>
        prisma.attemptAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId: attempt.id,
              questionId: ans.questionId,
            },
          },
          update: {
            optionId: ans.optionId || null,
            textAnswer: ans.textAnswer || null,
          },
          create: {
            attemptId: attempt.id,
            questionId: ans.questionId,
            optionId: ans.optionId || null,
            textAnswer: ans.textAnswer || null,
          },
        })
      )
    );

    return res.status(200).json({
      success: true,
      message: 'Answers saved successfully',
      data: {
        savedCount: answers.length,
        savedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Save attempt answers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/tests/:id/attempts (ADMIN, TEACHER)
 * Paginated list of enrolled students with attempt status (IN_PROGRESS, SUBMITTED, EXPIRED, NOT_STARTED).
 */
export async function getTestAttemptsStaff(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const branchId = req.user.branchId;

    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        batch: { select: { branchId: true } },
      },
    });

    if (!test || test.archivedAt !== null || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found, archived, or access denied',
      });
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const statusFilter = req.query.status as string | undefined;

    // Fetch active enrollments in batch
    const enrollments = await prisma.enrollment.findMany({
      where: {
        batchId: test.batchId,
        status: 'ACTIVE',
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Fetch all attempts for test
    const attempts = await prisma.testAttempt.findMany({
      where: { testId },
      include: {
        result: {
          select: {
            id: true,
            totalMarksObtained: true,
            rank: true,
            submittedAt: true,
          },
        },
      },
    });

    const attemptMap = new Map(attempts.map((a) => [a.studentId, a]));

    let items = enrollments.map((enr) => {
      const att = attemptMap.get(enr.student.id);
      if (!att) {
        return {
          student: enr.student,
          status: 'NOT_STARTED',
          attempt: null,
          result: null,
        };
      }
      return {
        student: enr.student,
        status: att.status,
        attempt: {
          id: att.id,
          startedAt: att.startedAt,
          deadlineAt: att.deadlineAt,
          submittedAt: att.submittedAt,
          extendedMinutes: att.extendedMinutes,
          extendReason: att.extendReason,
        },
        result: att.result,
      };
    });

    if (statusFilter) {
      items = items.filter((item) => item.status === statusFilter);
    }

    const total = items.length;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    return res.status(200).json({
      success: true,
      message: 'Test attempts retrieved successfully',
      data: {
        items: paginatedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (error) {
    console.error('Get test attempts staff error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/tests/:id/attempts/:attemptId/extend (ADMIN, TEACHER)
 * Grants extra time (1-60 mins) with audit trail.
 */
export async function extendTestAttempt(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const attemptId = req.params.attemptId as string;
    const branchId = req.user.branchId;

    const parseResult = extendAttemptSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { minutes, reason } = parseResult.data;

    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        batch: { select: { branchId: true, teacherId: true } },
      },
    });

    if (!test || test.archivedAt !== null || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found, archived, or access denied',
      });
    }

    // Role check: if teacher, must be batch teacher or admin
    if (req.user.role === Role.TEACHER && test.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not assigned to this batch',
      });
    }

    const attempt = await prisma.testAttempt.findUnique({
      where: { id: attemptId },
      include: { result: true },
    });

    if (!attempt || attempt.testId !== testId) {
      return res.status(404).json({
        success: false,
        message: 'Attempt not found for this test',
      });
    }

    // Cannot extend if result already exists or already submitted
    if (attempt.result || attempt.status === AttemptStatus.SUBMITTED) {
      return res.status(409).json({
        success: false,
        code: 'CANNOT_EXTEND_COMPLETED',
        message: 'Cannot extend an attempt that has already been submitted or completed',
      });
    }

    // If expired, must be within REOPEN_WINDOW_MINUTES (30 min) of deadline
    const now = new Date();
    const reopenCutoff = new Date(
      new Date(attempt.deadlineAt).getTime() + EXAM_CONFIG.REOPEN_WINDOW_MINUTES * 60 * 1000
    );

    if (attempt.status === AttemptStatus.EXPIRED && now > reopenCutoff) {
      return res.status(400).json({
        success: false,
        message: 'Cannot extend attempt after reopen window has expired',
      });
    }

    // New deadline: current deadline + minutes
    const newDeadline = new Date(
      new Date(attempt.deadlineAt).getTime() + minutes * 60 * 1000
    );

    const updated = await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: {
        extendedMinutes: attempt.extendedMinutes + minutes,
        deadlineAt: newDeadline,
        status: AttemptStatus.IN_PROGRESS,
        extendedById: req.user.userId,
        extendReason: reason,
      },
    });

    await createAuditLog({
      actorId: req.user.userId,
      action: 'EXTEND_TEST_ATTEMPT',
      entityType: 'TestAttempt',
      entityId: attempt.id,
      branchId,
      metadata: {
        testId,
        studentId: attempt.studentId,
        attemptId: attempt.id,
        extendedMinutes: minutes,
        newDeadlineAt: newDeadline.toISOString(),
        reason,
      },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Attempt extended successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Extend test attempt error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * POST /api/tests/:id/finalize (ADMIN, TEACHER)
 * Finalizes all expired attempts without a Result for the test, grades saved answers,
 * and recomputes ranks.
 */
export async function finalizeTestAttempts(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.id as string;
    const branchId = req.user.branchId;

    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        batch: { select: { branchId: true, teacherId: true } },
        questions: {
          include: { options: true },
        },
      },
    });

    if (!test || test.archivedAt !== null || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found, archived, or access denied',
      });
    }

    if (req.user.role === Role.TEACHER && test.batch.teacherId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not assigned to this batch',
      });
    }

    const now = new Date();
    const graceCutoff = new Date(now.getTime() - EXAM_CONFIG.SUBMISSION_GRACE_SECONDS * 1000);

    // Find all attempts past deadline+grace with no result
    const expiredAttempts = await prisma.testAttempt.findMany({
      where: {
        testId,
        status: { not: AttemptStatus.SUBMITTED },
        deadlineAt: { lt: graceCutoff },
        result: null,
      },
    });

    let finalizedCount = 0;

    for (const att of expiredAttempts) {
      await prisma.$transaction(async (tx) => {
        await finalizeExpiredAttemptInTx(tx, att, test);
      });
      finalizedCount++;
    }

    // Recompute ranks across the whole test once all are finalized
    if (finalizedCount > 0) {
      await recomputeRanks(testId);
    }

    await createAuditLog({
      actorId: req.user.userId,
      action: 'FINALIZE_TEST_ATTEMPTS',
      entityType: 'Test',
      entityId: testId,
      branchId,
      metadata: {
        testId,
        finalizedCount,
      },
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: `Finalized ${finalizedCount} expired attempt(s)`,
      data: {
        finalizedCount,
      },
    });
  } catch (error) {
    console.error('Finalize test attempts error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}


import { Request, Response } from 'express';
import { Role, QuestionType, AttemptStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { submitAnswersSchema, gradeWrittenAnswerSchema } from '../validators/submission.validator';
import { sendEmail } from '../utils/mailer';
import { getNotificationRecipients } from '../utils/notification-recipients';
import { escapeHtml } from '../utils/escapeHtml';
import { EXAM_CONFIG } from '../config/academics.config';
import { recomputeRanks } from '../utils/ranks';

export async function submitTest(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const studentId = req.user.userId;
    const branchId = req.user.branchId;

    // Validate body
    const parseResult = submitAnswersSchema.safeParse({ ...req.body, testId });
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { answers } = parseResult.data;

    // 1. Retrieve the test with questions and options
    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: {
        batch: true,
        questions: {
          include: {
            options: true,
          },
        },
      },
    });

    if (!test || test.archivedAt !== null || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found, archived, or access denied',
      });
    }

    // 2. Verify active enrollment
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        batchId: test.batchId,
        status: 'ACTIVE',
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not actively enrolled in this batch',
      });
    }

    // 3. Find attempt
    const attempt = await prisma.testAttempt.findUnique({
      where: {
        testId_studentId: {
          testId,
          studentId,
        },
      },
    });

    if (!attempt) {
      return res.status(400).json({
        success: false,
        code: 'ATTEMPT_NOT_STARTED',
        message: 'No active attempt found. You must start the test before submitting.',
      });
    }

    if (attempt.status === AttemptStatus.SUBMITTED) {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'Test has already been submitted by this student',
      });
    }

    // 4. Validate submission deadline (deadlineAt + 30s grace)
    const now = new Date();
    const submissionCutoff = new Date(
      new Date(attempt.deadlineAt).getTime() + EXAM_CONFIG.SUBMISSION_GRACE_SECONDS * 1000
    );

    if (now > submissionCutoff) {
      return res.status(400).json({
        success: false,
        code: 'ATTEMPT_CLOSED',
        message: 'Test submission deadline has passed',
      });
    }

    // 5. Fetch any autosaved answers to merge
    const autosavedAnswers = await prisma.attemptAnswer.findMany({
      where: { attemptId: attempt.id },
    });

    const mergedAnswerMap = new Map<
      string,
      { selectedOptionId: string | null; writtenAnswerText: string | null }
    >();

    for (const a of autosavedAnswers) {
      mergedAnswerMap.set(a.questionId, {
        selectedOptionId: a.optionId,
        writtenAnswerText: a.textAnswer,
      });
    }

    for (const a of answers) {
      mergedAnswerMap.set(a.questionId, {
        selectedOptionId: a.selectedOptionId || null,
        writtenAnswerText: a.writtenAnswerText || null,
      });
    }

    // Run scoring & creation inside a transaction
    const finalResult = await prisma.$transaction(async (tx) => {
      // Concurrency / double-submit guard
      const existingResult = await tx.result.findUnique({
        where: {
          studentId_testId: {
            studentId,
            testId,
          },
        },
      });

      if (existingResult) {
        throw new Error('ALREADY_SUBMITTED');
      }

      let totalScore = 0;
      const createdAnswers = [];

      for (const question of test.questions) {
        const studentAns = mergedAnswerMap.get(question.id);

        let selectedOptionId: string | null = null;
        let writtenAnswerText: string | null = null;
        let marksAwarded: number | null = null;

        if (question.type === QuestionType.MCQ) {
          selectedOptionId = studentAns?.selectedOptionId || null;
          const correctOption = question.options.find((o) => o.isCorrect);

          if (!selectedOptionId) {
            marksAwarded = 0;
          } else if (correctOption && selectedOptionId === correctOption.id) {
            marksAwarded = question.marks;
          } else {
            marksAwarded = -test.negativeMarkingValue;
          }
          totalScore += marksAwarded;
        } else {
          writtenAnswerText = studentAns?.writtenAnswerText || null;
          marksAwarded = null; // Stays null until graded
        }

        const savedAnswer = await tx.studentAnswer.create({
          data: {
            studentId,
            questionId: question.id,
            selectedOptionId,
            writtenAnswerText,
            marksAwarded,
          },
        });
        createdAnswers.push(savedAnswer);
      }

      // Create test result record
      const resultRecord = await tx.result.create({
        data: {
          studentId,
          testId,
          attemptId: attempt.id,
          totalMarksObtained: totalScore,
          submittedAt: now,
        },
      });

      // Update attempt status
      await tx.testAttempt.update({
        where: { id: attempt.id },
        data: {
          status: AttemptStatus.SUBMITTED,
          submittedAt: now,
        },
      });

      // Recompute ranks atomically under advisory lock
      await recomputeRanks(testId, tx);

      return {
        result: resultRecord,
        answers: createdAnswers,
      };
    });

    // Re-fetch result with persisted rank
    const rankedResult = await prisma.result.findUnique({
      where: { id: finalResult.result.id },
    });

    return res.status(201).json({
      success: true,
      message: 'Test submitted successfully',
      data: {
        resultId: finalResult.result.id,
        totalMarksObtained: finalResult.result.totalMarksObtained,
        rank: rankedResult?.rank ?? null,
        submittedAt: finalResult.result.submittedAt,
      },
    });
  } catch (error: any) {
    if (error?.message === 'ALREADY_SUBMITTED' || error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: 'Test has already been submitted by this student',
      });
    }
    console.error('Submit test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function gradeWrittenAnswer(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const studentAnswerId = req.params.id as string;
    const branchId = req.user.branchId;

    const parseResult = gradeWrittenAnswerSchema.safeParse({ ...req.body, studentAnswerId });
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { marksAwarded } = parseResult.data;

    // 1. Retrieve student answer with test details
    const studentAnswer = await prisma.studentAnswer.findUnique({
      where: { id: studentAnswerId },
      include: {
        question: {
          include: {
            test: {
              include: { batch: { select: { branchId: true } } },
            },
          },
        },
      },
    });

    if (!studentAnswer || studentAnswer.question.test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Student answer not found or access denied',
      });
    }

    if (studentAnswer.question.type !== QuestionType.WRITTEN) {
      return res.status(400).json({
        success: false,
        message: 'Only written questions can be graded manually',
      });
    }

    const testId = studentAnswer.question.testId;
    const studentId = studentAnswer.studentId;

    // Run grading and result score updates in a transaction
    const updatedResult = await prisma.$transaction(async (tx) => {
      await tx.studentAnswer.update({
        where: { id: studentAnswerId },
        data: { marksAwarded },
      });

      const allAnswers = await tx.studentAnswer.findMany({
        where: {
          studentId,
          question: { testId },
        },
      });

      let newTotal = 0;
      for (const a of allAnswers) {
        if (a.marksAwarded !== null && a.marksAwarded !== undefined) {
          newTotal += a.marksAwarded;
        }
      }

      const resRec = await tx.result.update({
        where: {
          studentId_testId: {
            studentId,
            testId,
          },
        },
        data: {
          totalMarksObtained: newTotal,
        },
      });

      await recomputeRanks(testId, tx);

      return resRec;
    });

    // Re-fetch result with updated rank
    const finalizedResult = await prisma.result.findUnique({
      where: { id: updatedResult.id },
    });

    // Notification handling (fire-and-forget)
    const testWithBatch = await prisma.test.findUnique({
      where: { id: testId },
      select: {
        title: true,
        totalMarks: true,
        batch: { select: { name: true } },
      },
    });

    getNotificationRecipients(studentId)
      .then((recipients) => {
        if (recipients.student?.email) {
          sendEmail(
            [recipients.student.email],
            `Test Result Graded: ${testWithBatch?.title ?? 'Test'}`,
            `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
              <h2 style="color:#6366f1">Your Test Has Been Graded</h2>
              <p>Hi ${escapeHtml(recipients.student.name || 'Student')},</p>
              <p>Your written submission for <strong>${escapeHtml(testWithBatch?.title ?? 'Test')}</strong> has been graded.</p>
              <p>Your updated total score is: <strong>${escapeHtml(String(finalizedResult?.totalMarksObtained ?? updatedResult.totalMarksObtained))}</strong>${testWithBatch?.totalMarks != null ? ` / ${escapeHtml(String(testWithBatch.totalMarks))}` : ''}.</p>
              <p style="margin-top:16px;color:#6b7280;font-size:13px">Log in to EduFlow to review feedback.</p>
            </div>
            `
          );
        }

        for (const guardian of recipients.guardians) {
          if (guardian.email) {
            sendEmail(
              [guardian.email],
              `Student Test Result Graded: ${testWithBatch?.title ?? 'Test'}`,
              `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                <h2 style="color:#6366f1">Test Result Available</h2>
                <p>Dear ${escapeHtml(guardian.name || 'Parent/Guardian')},</p>
                <p>Test result for your child <strong>${escapeHtml(recipients.student?.name || 'Student')}</strong> has been published:</p>
                <table style="width:100%;border-collapse:collapse;margin-top:16px">
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Test</td><td style="padding:8px;border:1px solid #e5e7eb">${escapeHtml(testWithBatch?.title ?? 'N/A')}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Total Marks</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;color:#6366f1">${escapeHtml(String(finalizedResult?.totalMarksObtained ?? updatedResult.totalMarksObtained))}</td></tr>
                </table>
              </div>
              `
            );
          }
        }
      })
      .catch((err) => console.error('[submission] Notification error:', err));

    return res.status(200).json({
      success: true,
      message: 'Written answer graded successfully',
      data: finalizedResult ?? updatedResult,
    });
  } catch (error) {
    console.error('Grade written answer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

/**
 * GET /api/tests/:testId/results (ADMIN, TEACHER)
 * Strictly read-only: returns existing ranked results without performing any DB writes.
 */
export async function getTestResults(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const branchId = req.user.branchId;

    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: { batch: { select: { branchId: true } } },
    });

    if (!test || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // Retrieve results ordered by rank ascending (nulls last) then marks descending. ZERO writes.
    const results = await prisma.result.findMany({
      where: { testId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            studentAnswers: {
              where: {
                question: { testId },
              },
              include: {
                question: {
                  select: {
                    id: true,
                    type: true,
                    text: true,
                    marks: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { rank: 'asc' },
        { totalMarksObtained: 'desc' },
      ],
    });

    return res.status(200).json({
      success: true,
      message: 'Test results retrieved successfully',
      data: results,
    });
  } catch (error) {
    console.error('Get test results error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function saveBatchManualResults(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const branchId = req.user.branchId;
    const { results } = req.body;

    if (!Array.isArray(results)) {
      return res.status(400).json({
        success: false,
        message: 'Results body must be an array of student marks',
      });
    }

    const test = await prisma.test.findUnique({
      where: { id: testId },
      include: { batch: { select: { branchId: true } } },
    });

    if (!test || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // Upsert each result and recompute ranks in a single transaction
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      for (const item of results) {
        if (typeof item.studentId === 'string' && typeof item.marksObtained === 'number') {
          await tx.result.upsert({
            where: {
              studentId_testId: {
                studentId: item.studentId,
                testId,
              },
            },
            update: {
              totalMarksObtained: item.marksObtained,
              submittedAt: now,
            },
            create: {
              studentId: item.studentId,
              testId,
              totalMarksObtained: item.marksObtained,
              submittedAt: now,
            },
          });
        }
      }

      await recomputeRanks(testId, tx);
    });

    // Fire notifications asynchronously
    const testWithBatch = await prisma.test.findUnique({
      where: { id: testId },
      select: {
        title: true,
        totalMarks: true,
        batch: { select: { name: true } },
      },
    });

    for (const item of results) {
      if (typeof item.studentId === 'string' && typeof item.marksObtained === 'number') {
        const studentId = item.studentId;
        const marksObtained = item.marksObtained;
        getNotificationRecipients(studentId)
          .then((recipients) => {
            if (recipients.student?.email) {
              sendEmail(
                [recipients.student.email],
                `Test Result Available: ${testWithBatch?.title ?? 'Test'}`,
                `<p>Your score for <strong>${escapeHtml(testWithBatch?.title ?? 'Test')}</strong> is: <strong>${escapeHtml(String(marksObtained))}</strong>.</p>`
              );
            }
          })
          .catch((err) => console.error('[submission] Manual result notification error:', err));
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Manual test results saved and ranked successfully',
    });
  } catch (error) {
    console.error('Save manual results error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function getStudentResult(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const studentId = req.user.userId;

    const result = await prisma.result.findUnique({
      where: {
        studentId_testId: {
          studentId,
          testId,
        },
      },
      include: {
        test: {
          select: {
            id: true,
            title: true,
            type: true,
            totalMarks: true,
            testDate: true,
            durationMinutes: true,
            windowEndsAt: true,
          },
        },
      },
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No result record found for this test',
      });
    }

    const answers = await prisma.studentAnswer.findMany({
      where: {
        studentId,
        question: { testId },
      },
      include: {
        question: {
          include: {
            options: {
              select: {
                id: true,
                text: true,
                isCorrect: true,
              },
            },
          },
        },
        selectedOption: {
          select: {
            id: true,
            text: true,
          },
        },
      },
      orderBy: {
        question: {
          order: 'asc',
        },
      },
    });

    // Strip isCorrect for students until test window has closed
    let sanitizedAnswers = answers;
    if (req.user.role === Role.STUDENT) {
      const now = new Date();
      const testDate = new Date(result.test.testDate);
      const testEndTime = result.test.windowEndsAt
        ? new Date(result.test.windowEndsAt)
        : result.test.durationMinutes
        ? new Date(testDate.getTime() + result.test.durationMinutes * 60 * 1000)
        : testDate;

      if (now <= testEndTime) {
        sanitizedAnswers = answers.map((ans) => ({
          ...ans,
          question: {
            ...ans.question,
            options: ans.question.options.map((opt) => {
              const { isCorrect, ...restOpt } = opt;
              return restOpt;
            }) as any,
          },
        }));
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Student test result retrieved successfully',
      data: {
        result,
        answers: sanitizedAnswers,
      },
    });
  } catch (error) {
    console.error('Get student result error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

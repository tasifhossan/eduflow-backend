import { Request, Response } from 'express';
import { PrismaClient, Role, QuestionType } from '@prisma/client';
import { submitAnswersSchema, gradeWrittenAnswerSchema } from '../validators/submission.validator';
import { sendEmail } from '../utils/mailer';
import { getNotificationRecipients } from '../utils/notification-recipients';

const prisma = new PrismaClient();

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

    if (!test || test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // 2. Verify the student is enrolled in the batch
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        batchId: test.batchId,
      },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not enrolled in this batch',
      });
    }

    // 3. Verify they haven't submitted already
    const existingResult = await prisma.result.findUnique({
      where: {
        studentId_testId: {
          studentId,
          testId,
        },
      },
    });

    if (existingResult) {
      return res.status(400).json({
        success: false,
        message: 'Test has already been submitted by this student',
      });
    }

    // Run scoring & creation inside a transaction
    const finalResult = await prisma.$transaction(async (tx) => {
      let totalScore = 0;
      const createdAnswers = [];

      for (const question of test.questions) {
        const studentAns = answers.find((a) => a.questionId === question.id);

        let selectedOptionId: string | null = null;
        let writtenAnswerText: string | null = null;
        let marksAwarded: number | null = null;

        if (question.type === QuestionType.MCQ) {
          selectedOptionId = studentAns?.selectedOptionId || null;
          const correctOption = question.options.find((o) => o.isCorrect);

          if (!selectedOptionId) {
            // Unanswered MCQ
            marksAwarded = 0;
          } else if (correctOption && selectedOptionId === correctOption.id) {
            // Correct answer
            marksAwarded = question.marks;
          } else {
            // Wrong answer, apply negative marking
            marksAwarded = -test.negativeMarkingValue;
          }
          totalScore += marksAwarded;
        } else {
          // WRITTEN answer, graded manually by teacher later
          writtenAnswerText = studentAns?.writtenAnswerText || null;
          marksAwarded = null; // Stays null until graded
        }

        // Create student answer record
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
          totalMarksObtained: totalScore,
          submittedAt: new Date(),
        },
      });

      return {
        result: resultRecord,
        answers: createdAnswers,
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Test submitted successfully',
      data: {
        resultId: finalResult.result.id,
        totalMarksObtained: finalResult.result.totalMarksObtained,
        submittedAt: finalResult.result.submittedAt,
      },
    });
  } catch (error) {
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

    // Validate body
    const parseResult = gradeWrittenAnswerSchema.safeParse({ ...req.body, studentAnswerId });
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { marksAwarded } = parseResult.data;

    // 1. Retrieve the student answer with parent test details
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
      // 1. Update the StudentAnswer with marksAwarded
      await tx.studentAnswer.update({
        where: { id: studentAnswerId },
        data: { marksAwarded },
      });

      // 2. Fetch all student answers for this test to recalculate total
      const allAnswers = await tx.studentAnswer.findMany({
        where: {
          studentId,
          question: { testId },
        },
      });

      const totalMarksObtained = allAnswers.reduce(
        (sum, ans) => sum + (ans.marksAwarded || 0),
        0
      );

      // 3. Update the parent Result record
      return tx.result.update({
        where: {
          studentId_testId: {
            studentId,
            testId,
          },
        },
        data: {
          totalMarksObtained,
        },
      });
    });

    // Fire-and-forget: notify student (and linked guardians) when the test is fully graded
    // A test is "fully graded" when every written answer now has marksAwarded set.
    const pendingWritten = await prisma.studentAnswer.count({
      where: {
        studentId,
        question: { testId, type: QuestionType.WRITTEN },
        marksAwarded: null,
      },
    });

    if (pendingWritten === 0) {
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
          // 1. Send to Student if available
          if (recipients.student?.email) {
            sendEmail(
              [recipients.student.email],
              `Test Result Available – ${testWithBatch?.title ?? 'Test'} (${testWithBatch?.batch.name ?? ''})`,
              `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                <h2 style="color:#6366f1">Test Result Available</h2>
                <p>Dear ${recipients.student.name},</p>
                <p>Your test result for <strong>${testWithBatch?.title ?? 'Test'}</strong> in <strong>${testWithBatch?.batch.name ?? 'Batch'}</strong> has been published:</p>
                <table style="width:100%;border-collapse:collapse;margin-top:16px">
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Test</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.title ?? 'N/A'}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Batch</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.batch.name ?? 'N/A'}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Total Marks Obtained</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;color:#6366f1">${updatedResult.totalMarksObtained}</td></tr>
                  ${testWithBatch?.totalMarks != null ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Out Of</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch.totalMarks}</td></tr>` : ''}
                </table>
                <p style="margin-top:16px;color:#6b7280;font-size:13px">Log in to EduFlow to see full details. This is an automated message.</p>
              </div>
              `
            );
          }

          // 2. Send to Guardian(s) if available
          for (const guardian of recipients.guardians) {
            if (!guardian.email) continue;
            sendEmail(
              [guardian.email],
              `Test Result Available – ${recipients.student?.name || 'Student'} (${testWithBatch?.batch.name ?? ''})`,
              `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                <h2 style="color:#6366f1">Test Result Available</h2>
                <p>Dear ${guardian.name || 'Parent/Guardian'},</p>
                <p>Test result for your child <strong>${recipients.student?.name || 'Student'}</strong> for <strong>${testWithBatch?.title ?? 'Test'}</strong> in <strong>${testWithBatch?.batch.name ?? 'Batch'}</strong> has been published:</p>
                <table style="width:100%;border-collapse:collapse;margin-top:16px">
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Test</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.title ?? 'N/A'}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Batch</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.batch.name ?? 'N/A'}</td></tr>
                  <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Total Marks Obtained</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;color:#6366f1">${updatedResult.totalMarksObtained}</td></tr>
                  ${testWithBatch?.totalMarks != null ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Out Of</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch.totalMarks}</td></tr>` : ''}
                </table>
                <p style="margin-top:16px;color:#6b7280;font-size:13px">Log in to EduFlow to see full details. This is an automated message.</p>
              </div>
              `
            );
          }
        })
        .catch((err) => console.error('[submission] Notification error:', err));
    }

    return res.status(200).json({
      success: true,
      message: 'Written answer graded successfully',
      data: updatedResult,
    });
  } catch (error) {
    console.error('Grade written answer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

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

    // Verify test branch ownership
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

    // Retrieve results sorted by totalMarksObtained desc, including student and their answers for this test
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
      orderBy: {
        totalMarksObtained: 'desc',
      },
    });

    // Compute ranks and create transaction updates
    let rank = 1;
    const updates = [];
    const rankedResults = [];

    for (let i = 0; i < results.length; i++) {
      if (i > 0 && results[i].totalMarksObtained < results[i - 1].totalMarksObtained) {
        rank = i + 1;
      }

      rankedResults.push({
        ...results[i],
        rank,
      });

      updates.push(
        prisma.result.update({
          where: { id: results[i].id },
          data: { rank },
        })
      );
    }

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }

    return res.status(200).json({
      success: true,
      message: 'Test results retrieved and ranked successfully',
      data: rankedResults,
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
    const { results } = req.body; // Array of { studentId: string, marksObtained: number }

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

    // Upsert each student result record
    for (const item of results) {
      if (typeof item.studentId === 'string' && typeof item.marksObtained === 'number') {
        await prisma.result.upsert({
          where: {
            studentId_testId: {
              studentId: item.studentId,
              testId,
            },
          },
          update: {
            totalMarksObtained: item.marksObtained,
            submittedAt: new Date(),
          },
          create: {
            studentId: item.studentId,
            testId,
            totalMarksObtained: item.marksObtained,
            submittedAt: new Date(),
          },
        });
      }
    }

    // Recalculate ranks across all results for this test
    const allResults = await prisma.result.findMany({
      where: { testId },
      orderBy: { totalMarksObtained: 'desc' },
    });

    let rank = 1;
    const rankUpdates = [];

    for (let i = 0; i < allResults.length; i++) {
      if (i > 0 && allResults[i].totalMarksObtained < allResults[i - 1].totalMarksObtained) {
        rank = i + 1;
      }
      rankUpdates.push(
        prisma.result.update({
          where: { id: allResults[i].id },
          data: { rank },
        })
      );
    }

    if (rankUpdates.length > 0) {
      await prisma.$transaction(rankUpdates);
    }

    // Fire-and-forget: notify students (and linked guardians) for manual / offline test results
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
            // 1. Send to Student if available
            if (recipients.student?.email) {
              sendEmail(
                [recipients.student.email],
                `Test Result Available – ${testWithBatch?.title ?? 'Test'} (${testWithBatch?.batch.name ?? ''})`,
                `
                <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                  <h2 style="color:#6366f1">Test Result Available</h2>
                  <p>Dear ${recipients.student.name},</p>
                  <p>Your test result for <strong>${testWithBatch?.title ?? 'Offline Test'}</strong> in <strong>${testWithBatch?.batch.name ?? 'Batch'}</strong> has been published:</p>
                  <table style="width:100%;border-collapse:collapse;margin-top:16px">
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Test</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.title ?? 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Batch</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.batch.name ?? 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Total Marks Obtained</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;color:#6366f1">${marksObtained}</td></tr>
                    ${testWithBatch?.totalMarks != null ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Out Of</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch.totalMarks}</td></tr>` : ''}
                  </table>
                  <p style="margin-top:16px;color:#6b7280;font-size:13px">Log in to EduFlow to see full details. This is an automated message.</p>
                </div>
                `
              );
            }

            // 2. Send to Guardian(s) if available
            for (const guardian of recipients.guardians) {
              if (!guardian.email) continue;
              sendEmail(
                [guardian.email],
                `Test Result Available – ${recipients.student?.name || 'Student'} (${testWithBatch?.batch.name ?? ''})`,
                `
                <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
                  <h2 style="color:#6366f1">Test Result Available</h2>
                  <p>Dear ${guardian.name || 'Parent/Guardian'},</p>
                  <p>Test result for your child <strong>${recipients.student?.name || 'Student'}</strong> for <strong>${testWithBatch?.title ?? 'Offline Test'}</strong> in <strong>${testWithBatch?.batch.name ?? 'Batch'}</strong> has been published:</p>
                  <table style="width:100%;border-collapse:collapse;margin-top:16px">
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Test</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.title ?? 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Batch</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch?.batch.name ?? 'N/A'}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Total Marks Obtained</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;color:#6366f1">${marksObtained}</td></tr>
                    ${testWithBatch?.totalMarks != null ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">Out Of</td><td style="padding:8px;border:1px solid #e5e7eb">${testWithBatch.totalMarks}</td></tr>` : ''}
                  </table>
                  <p style="margin-top:16px;color:#6b7280;font-size:13px">Log in to EduFlow to see full details. This is an automated message.</p>
                </div>
                `
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

    // Verify Result exists
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

    // Retrieve the student's detailed answers
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
                isCorrect: true, // Leak correct answers ONLY after submission (which is guaranteed here!)
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

    return res.status(200).json({
      success: true,
      message: 'Student test result retrieved successfully',
      data: {
        result,
        answers,
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

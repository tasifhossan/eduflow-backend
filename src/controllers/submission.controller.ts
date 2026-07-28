import { Request, Response } from 'express';
import { PrismaClient, Role, QuestionType } from '@prisma/client';
import { submitAnswersSchema, gradeWrittenAnswerSchema } from '../validators/submission.validator';

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

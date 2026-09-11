import { Request, Response } from 'express';
import { PrismaClient, Role, QuestionType } from '@prisma/client';
import { createPracticeSessionSchema, submitPracticeSessionSchema } from '../validators/practice.validator';
import { getBatchChapterWeakSpots } from '../utils/analytics';
import { scoreMcqQuestion } from '../utils/scoring';

const prisma = new PrismaClient();

// POST /api/students/:studentId/practice-sessions
// STUDENT only, only for their own studentId
export async function createPracticeSession(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { role, userId } = req.user;
    const studentId = req.params.studentId as string;

    // STUDENT only check
    if (role !== Role.STUDENT) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only students can generate practice sessions',
      });
    }

    // Own studentId check
    if (userId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only generate practice sessions for yourself',
      });
    }

    // Validate body
    const parseResult = createPracticeSessionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { batchId, chapterIds, limit } = parseResult.data;

    // Verify enrollment
    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId, batchId, status: 'ACTIVE' },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You are not enrolled in this batch',
      });
    }

    // Determine target chapters
    let selectedChapterIds: string[] = chapterIds && chapterIds.length > 0 ? chapterIds : [];

    if (selectedChapterIds.length === 0) {
      // Auto-select student's weak chapters in this batch
      const weakSpots = await getBatchChapterWeakSpots(prisma, batchId, studentId);
      if (weakSpots.length > 0) {
        selectedChapterIds = weakSpots.slice(0, 3).map((ws) => ws.chapterId);
      } else {
        // Fall back to batch-wide weak spots
        const batchWeakSpots = await getBatchChapterWeakSpots(prisma, batchId);
        if (batchWeakSpots.length > 0) {
          selectedChapterIds = batchWeakSpots.slice(0, 3).map((ws) => ws.chapterId);
        } else {
          // Fall back to chapters in batch subject
          const batchInfo = await prisma.batch.findUnique({
            where: { id: batchId },
            select: { subjectId: true },
          });
          if (batchInfo) {
            const chapters = await prisma.chapter.findMany({
              where: { subjectId: batchInfo.subjectId },
              select: { id: true },
            });
            selectedChapterIds = chapters.map((c) => c.id);
          }
        }
      }
    }

    // 1. Pull existing MCQ questions from tests tagged with selected chapter(s) in this batch
    let availableQuestions = await prisma.question.findMany({
      where: {
        type: QuestionType.MCQ,
        test: {
          batchId,
          ...(selectedChapterIds.length > 0 ? { chapterId: { in: selectedChapterIds } } : {}),
        },
      },
      include: {
        options: {
          select: {
            id: true,
            text: true,
          },
        },
      },
    });

    // Fall back to any MCQ question in the batch if chapter filter yields no questions
    if (availableQuestions.length === 0) {
      availableQuestions = await prisma.question.findMany({
        where: {
          type: QuestionType.MCQ,
          test: { batchId },
        },
        include: {
          options: {
            select: {
              id: true,
              text: true,
            },
          },
        },
      });
    }

    if (availableQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No practice questions available for this batch or chapters',
      });
    }

    // 2. Exclude questions student answered correctly in real tests
    const correctStudentAnswers = await prisma.studentAnswer.findMany({
      where: {
        studentId,
        marksAwarded: { gt: 0 },
      },
      select: { questionId: true },
    });
    const solvedQuestionIds = new Set(correctStudentAnswers.map((a) => a.questionId));

    const unmasteredQuestions = availableQuestions.filter((q) => !solvedQuestionIds.has(q.id));
    const questionPool = unmasteredQuestions.length > 0 ? unmasteredQuestions : availableQuestions;

    // 3. Select a set of questions (default 10, capped at 20)
    const shuffled = [...questionPool].sort(() => 0.5 - Math.random());
    const selectedQuestions = shuffled.slice(0, Math.min(20, Math.max(1, limit || 10)));

    // 4. Create PracticeSession row (leaving answers, correctAnswers, score, submittedAt null)
    const session = await prisma.practiceSession.create({
      data: {
        studentId,
        batchId,
        chapterIds: selectedChapterIds,
        questionIds: selectedQuestions.map((q) => q.id),
        totalQuestions: selectedQuestions.length,
      },
    });

    // 5. Return sessionId + questions to client with correct answers withheld
    const sanitizedQuestions = selectedQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      marks: q.marks,
      options: q.options.map((opt) => ({
        id: opt.id,
        text: opt.text,
      })),
    }));

    return res.status(201).json({
      success: true,
      message: 'Practice session generated successfully',
      data: {
        sessionId: session.id,
        batchId: session.batchId,
        chapterIds: session.chapterIds,
        totalQuestions: session.totalQuestions,
        createdAt: session.createdAt,
        questions: sanitizedQuestions,
      },
    });
  } catch (error) {
    console.error('Create practice session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

// POST /api/students/:studentId/practice-sessions/:sessionId/submit
// STUDENT only, only for their own studentId
export async function submitPracticeSession(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { role, userId } = req.user;
    const studentId = req.params.studentId as string;
    const sessionId = req.params.sessionId as string;

    // STUDENT only check
    if (role !== Role.STUDENT) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only students can submit practice sessions',
      });
    }

    // Own studentId check
    if (userId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only submit practice sessions for yourself',
      });
    }

    // Validate body
    const parseResult = submitPracticeSessionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { answers } = parseResult.data;

    // Fetch PracticeSession
    const session = await prisma.practiceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Practice session not found',
      });
    }

    if (session.studentId !== studentId || session.studentId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not own this practice session',
      });
    }

    // Reject re-submissions
    if (session.submittedAt) {
      return res.status(400).json({
        success: false,
        message: 'Practice session has already been submitted',
      });
    }

    // Fetch session questions and options for scoring
    const questions = await prisma.question.findMany({
      where: { id: { in: session.questionIds } },
      include: {
        options: true,
        test: {
          select: {
            negativeMarkingValue: true,
          },
        },
      },
    });

    let totalScore = 0;
    let totalMaxMarks = 0;
    let correctCount = 0;
    const reviewArray = [];

    for (const questionId of session.questionIds) {
      const question = questions.find((q) => q.id === questionId);
      if (!question) continue;

      const studentAns = answers.find((a) => a.questionId === questionId);
      const scored = scoreMcqQuestion({
        questionId: question.id,
        marks: question.marks,
        negativeMarkingValue: question.test?.negativeMarkingValue ?? 0,
        options: question.options,
        selectedOptionId: studentAns?.selectedOptionId,
      });

      if (scored.correct) {
        correctCount++;
      }

      totalScore += scored.marksAwarded;
      totalMaxMarks += question.marks;

      reviewArray.push({
        questionId: scored.questionId,
        selectedOptionId: scored.selectedOptionId,
        correctOptionId: scored.correctOptionId,
        correct: scored.correct,
      });
    }

    const scorePercentage =
      totalMaxMarks > 0
        ? parseFloat(((Math.max(0, totalScore) / totalMaxMarks) * 100).toFixed(2))
        : 0;

    // Update PracticeSession record
    const updatedSession = await prisma.practiceSession.update({
      where: { id: sessionId },
      data: {
        answers: reviewArray as any,
        correctAnswers: correctCount,
        score: scorePercentage,
        submittedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Practice session submitted successfully',
      data: {
        sessionId: updatedSession.id,
        score: updatedSession.score,
        correctAnswers: updatedSession.correctAnswers,
        totalQuestions: updatedSession.totalQuestions,
        submittedAt: updatedSession.submittedAt,
        answers: reviewArray,
      },
    });
  } catch (error) {
    console.error('Submit practice session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

// GET /api/students/:studentId/practice-sessions/:sessionId
// STUDENT only, only for their own studentId
export async function getPracticeSession(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const { role, userId } = req.user;
    const studentId = req.params.studentId as string;
    const sessionId = req.params.sessionId as string;

    if (role !== Role.STUDENT) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only students can access practice sessions',
      });
    }

    if (userId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only access your own practice sessions',
      });
    }

    const session = await prisma.practiceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Practice session not found',
      });
    }

    if (session.studentId !== studentId || session.studentId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not own this practice session',
      });
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: session.questionIds } },
      include: {
        options: {
          select: {
            id: true,
            text: true,
          },
        },
      },
    });

    const orderedQuestions = session.questionIds
      .map((qId) => questions.find((q) => q.id === qId))
      .filter(Boolean)
      .map((q) => ({
        id: q!.id,
        text: q!.text,
        marks: q!.marks,
        options: q!.options.map((opt) => ({
          id: opt.id,
          text: opt.text,
        })),
      }));

    return res.status(200).json({
      success: true,
      message: 'Practice session retrieved successfully',
      data: {
        sessionId: session.id,
        batchId: session.batchId,
        chapterIds: session.chapterIds,
        totalQuestions: session.totalQuestions,
        correctAnswers: session.correctAnswers,
        score: session.score,
        createdAt: session.createdAt,
        submittedAt: session.submittedAt,
        answers: session.answers,
        questions: orderedQuestions,
      },
    });
  } catch (error) {
    console.error('Get practice session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}



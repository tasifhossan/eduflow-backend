import { Request, Response } from 'express';
import { PrismaClient, QuestionType } from '@prisma/client';
import { createQuestionSchema } from '../validators/test.validator';
import { z } from 'zod';

const prisma = new PrismaClient();

// Helper to verify test ownership
async function verifyTestOwnership(testId: string, branchId: string): Promise<boolean> {
  const test = await prisma.test.findUnique({
    where: { id: testId },
    include: { batch: { select: { branchId: true } } },
  });
  return !!test && test.batch.branchId === branchId;
}

export async function addQuestion(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const branchId = req.user.branchId;

    // Verify test exists and belongs to branch
    const isOwner = await verifyTestOwnership(testId, branchId);
    if (!isOwner) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    const parseResult = createQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { type, text, marks, order, options } = parseResult.data;

    // Create question with options in a single Prisma nested create
    const question = await prisma.question.create({
      data: {
        testId,
        type,
        text,
        marks,
        order,
        options: type === QuestionType.MCQ && options ? {
          create: options.map((opt) => ({
            text: opt.text,
            isCorrect: opt.isCorrect,
          })),
        } : undefined,
      },
      include: {
        options: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Question added successfully',
      data: question,
    });
  } catch (error) {
    console.error('Add question error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function addQuestionsBulk(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const testId = req.params.testId as string;
    const branchId = req.user.branchId;

    // Verify test exists and belongs to branch
    const isOwner = await verifyTestOwnership(testId, branchId);
    if (!isOwner) {
      return res.status(404).json({
        success: false,
        message: 'Test not found or access denied',
      });
    }

    // Validate body is a JSON array
    const bulkSchema = z.array(createQuestionSchema);
    const parseResult = bulkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const questionsData = parseResult.data;

    // Create all questions in a single transaction
    const createdQuestions = await prisma.$transaction(
      questionsData.map((q) =>
        prisma.question.create({
          data: {
            testId,
            type: q.type,
            text: q.text,
            marks: q.marks,
            order: q.order,
            options: q.type === QuestionType.MCQ && q.options ? {
              create: q.options.map((opt) => ({
                text: opt.text,
                isCorrect: opt.isCorrect,
              })),
            } : undefined,
          },
          include: {
            options: true,
          },
        })
      )
    );

    return res.status(201).json({
      success: true,
      message: `${createdQuestions.length} questions added successfully in bulk`,
      data: createdQuestions,
    });
  } catch (error) {
    console.error('Add questions bulk error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function updateQuestion(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    // Retrieve question and test to verify ownership
    const existingQuestion = await prisma.question.findUnique({
      where: { id },
      include: {
        test: {
          include: { batch: { select: { branchId: true } } },
        },
      },
    });

    if (!existingQuestion || existingQuestion.test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Question not found or access denied',
      });
    }

    const parseResult = createQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        data: parseResult.error.flatten(),
      });
    }

    const { type, text, marks, order, options } = parseResult.data;

    // Use a transaction to update the question, delete old options, and insert new options
    const updatedQuestion = await prisma.$transaction(async (tx) => {
      // 1. Delete all existing options for this question
      await tx.option.deleteMany({
        where: { questionId: id },
      });

      // 2. Update question fields and create new options
      return tx.question.update({
        where: { id },
        data: {
          type,
          text,
          marks,
          order,
          options: type === QuestionType.MCQ && options ? {
            create: options.map((opt) => ({
              text: opt.text,
              isCorrect: opt.isCorrect,
            })),
          } : undefined,
        },
        include: {
          options: true,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully',
      data: updatedQuestion,
    });
  } catch (error) {
    console.error('Update question error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

export async function deleteQuestion(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    const id = req.params.id as string;
    const branchId = req.user.branchId;

    // Retrieve question and test to verify ownership
    const existingQuestion = await prisma.question.findUnique({
      where: { id },
      include: {
        test: {
          include: { batch: { select: { branchId: true } } },
        },
      },
    });

    if (!existingQuestion || existingQuestion.test.batch.branchId !== branchId) {
      return res.status(404).json({
        success: false,
        message: 'Question not found or access denied',
      });
    }

    await prisma.question.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: 'Question deleted successfully',
    });
  } catch (error) {
    console.error('Delete question error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

import { z } from 'zod';
import { TestType, QuestionType } from '@prisma/client';

export const createTestSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  type: z.nativeEnum(TestType, { message: 'Invalid test type' }),
  batchId: z.string().min(1, 'Batch ID is required'),
  chapterId: z.string().optional().nullable(),
  totalMarks: z.number().positive('Total marks must be a positive number'),
  negativeMarkingValue: z.number().min(0, 'Negative marking value cannot be negative').default(0),
  durationMinutes: z.number().optional().nullable(),
  testDate: z.string().datetime({ message: 'Test date must be a valid ISO date string' }),
  windowEndsAt: z.string().datetime({ message: 'Window ends date must be a valid ISO date string' }).optional().nullable(),
  shuffleQuestions: z.boolean().optional().default(false),
  shuffleOptions: z.boolean().optional().default(false),
});

const questionBase = z.object({
  type: z.nativeEnum(QuestionType, { message: 'Invalid question type' }),
  text: z.string().min(3, 'Question text must be at least 3 characters long'),
  marks: z.number().positive('Question marks must be a positive number'),
  order: z.number().int('Order must be an integer'),
  options: z.array(
    z.object({
      text: z.string().min(1, 'Option text is required'),
      isCorrect: z.boolean().default(false),
    })
  ).optional().default([]),
});

export const createQuestionSchema = questionBase.refine((data) => {
  if (data.type === QuestionType.MCQ) {
    if (!data.options || data.options.length === 0) {
      return false;
    }
    const correctOptions = data.options.filter((o) => o.isCorrect);
    return correctOptions.length === 1;
  }
  return true;
}, {
  message: 'MCQ questions must have at least one option and exactly one correct option',
  path: ['options'],
});

export const updateTestSchema = createTestSchema.partial();

export const updateQuestionSchema = questionBase.partial().refine((data) => {
  if (data.type === QuestionType.MCQ) {
    if (!data.options || data.options.length === 0) {
      return false;
    }
    const correctOptions = data.options.filter((o) => o?.isCorrect);
    return correctOptions.length === 1;
  }
  return true;
}, {
  message: 'MCQ questions must have at least one option and exactly one correct option',
  path: ['options'],
});

export const saveAttemptAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'Question ID is required'),
      optionId: z.string().optional().nullable(),
      textAnswer: z.string().optional().nullable(),
    }).refine(
      (data) => {
        const hasOption = !!data.optionId;
        const hasText = typeof data.textAnswer === 'string' && data.textAnswer.trim().length > 0;
        return (hasOption && !hasText) || (!hasOption && hasText);
      },
      { message: 'Answer must provide either optionId or textAnswer, not both' }
    )
  ),
});

export const extendAttemptSchema = z.object({
  minutes: z.number().int().min(1, 'Minutes must be at least 1').max(60, 'Minutes cannot exceed 60'),
  reason: z.string().min(3, 'Reason must be at least 3 characters long'),
});


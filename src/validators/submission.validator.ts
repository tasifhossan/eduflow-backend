import { z } from 'zod';

export const submitAnswersSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'Question ID is required'),
      selectedOptionId: z.string().optional().nullable(),
      writtenAnswerText: z.string().optional().nullable(),
    })
  ),
});

export const gradeWrittenAnswerSchema = z.object({
  studentAnswerId: z.string().min(1, 'Student Answer ID is required'),
  marksAwarded: z.number().min(0, 'Marks awarded cannot be negative'),
});

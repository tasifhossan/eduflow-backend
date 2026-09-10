export interface McqQuestionScoringInput {
  questionId: string;
  marks: number;
  negativeMarkingValue: number;
  options: { id: string; isCorrect: boolean }[];
  selectedOptionId?: string | null;
}

export interface McqScoringResult {
  questionId: string;
  selectedOptionId: string | null;
  correctOptionId: string | null;
  correct: boolean;
  marksAwarded: number;
}

/**
 * Shared MCQ scoring logic used across formal test submissions and practice sessions.
 * Applies full marks for correct answers, 0 for unanswered, and negative marking for incorrect choices.
 */
export function scoreMcqQuestion(input: McqQuestionScoringInput): McqScoringResult {
  const { questionId, marks, negativeMarkingValue, options, selectedOptionId } = input;
  const correctOption = options.find((o) => o.isCorrect);
  const correctOptionId = correctOption ? correctOption.id : null;

  let marksAwarded = 0;
  let correct = false;

  if (!selectedOptionId) {
    // Unanswered MCQ
    marksAwarded = 0;
    correct = false;
  } else if (correctOption && selectedOptionId === correctOption.id) {
    // Correct answer
    marksAwarded = marks;
    correct = true;
  } else {
    // Wrong answer, apply negative marking
    marksAwarded = -negativeMarkingValue;
    correct = false;
  }

  return {
    questionId,
    selectedOptionId: selectedOptionId || null,
    correctOptionId,
    correct,
    marksAwarded,
  };
}

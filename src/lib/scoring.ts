export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Server-side only — never sent to the client before scoring (see toPublicQuestion). */
  correctIndex: number;
  points?: number;
}

export interface SubmittedAnswer {
  questionId: string;
  selectedIndex: number;
}

/**
 * Pure scoring — no I/O, no clock, no DB — so it's trivially unit-testable
 * (Task 9.6) without any infrastructure. An unanswered or unknown question
 * simply scores 0; an answer referencing a question id that isn't in this
 * quiz is silently ignored (not an error — the client may have stale state).
 */
export function scoreAnswers(questions: QuizQuestion[], answers: SubmittedAnswer[]): number {
  const selectedByQuestion = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
  return questions.reduce((total, q) => {
    const selected = selectedByQuestion.get(q.id);
    const isCorrect = selected !== undefined && selected === q.correctIndex;
    return total + (isCorrect ? (q.points ?? 1) : 0);
  }, 0);
}

/** Strip the answer key before a quiz's questions are sent to start an attempt. */
export function toPublicQuestion(question: QuizQuestion): Omit<QuizQuestion, 'correctIndex'> {
  const { correctIndex: _correctIndex, ...rest } = question;
  return rest;
}

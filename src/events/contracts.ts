/**
 * Typed domain-event contracts.
 *
 * These are the shapes producers (services, inside a transaction) and
 * subscribers (job handlers, Task 7.4+) agree on. Keeping them in one place
 * means a subscriber can `switch` on `event.type` and get a narrowed,
 * type-checked `payload` — no stringly-typed guessing at either end.
 *
 * Adding a new event type: add a variant to `DomainEvent`, write it via
 * `writeOutboxEvent` in the same transaction as the change it describes,
 * and add a `case` in `src/queues/events.worker.ts`.
 */

export interface LessonCompletedPayload {
  userId: string;
  lessonId: string;
  /** XP the lesson is worth — the subscriber awards it, so it travels with the event. */
  xp: number;
}

export interface QuizSubmittedPayload {
  userId: string;
  quizId: string;
  attemptId: string;
  score: number;
  /** Whether this quiz opts into the live leaderboard (Task 9.5) — travels with the event so the subscriber doesn't need a second lookup. */
  contestMode: boolean;
}

export type DomainEvent =
  | { type: 'LessonCompleted'; payload: LessonCompletedPayload }
  | { type: 'QuizSubmitted'; payload: QuizSubmittedPayload };

export type DomainEventType = DomainEvent['type'];

/**
 * The `Notifier` PORT (in the ports & adapters / hexagonal sense): the shape
 * every notification channel implements. Callers (subscribers reacting to
 * domain events) depend on this interface only — never on a concrete channel
 * like "the in-app table" or "a WebSocket". Adding a channel later (email,
 * push) means writing one more adapter and registering it (`src/notifications/index.ts`);
 * nothing that already sends notifications has to change.
 */
export interface NotificationMessage {
  userId: string;
  /** Mirrors the domain event that caused this, e.g. "LessonCompleted". */
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface Notifier {
  /** Human-readable name for logging (e.g. "in-app", "realtime"). */
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}

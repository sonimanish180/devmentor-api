import { AppError } from './AppError';

/**
 * Optimistic Concurrency Control (OCC).
 *
 * Instead of locking a row while a user edits it (pessimistic), we let edits
 * proceed and detect conflicts at write time. The row carries a `version`; the
 * update is `WHERE id = ? AND version = <expected>` and bumps the version. If
 * someone else wrote first, the version no longer matches and 0 rows update —
 * we surface that as a 409 so the client can refetch and retry.
 *
 * Usage:
 *   await occUpdate(() => prisma.quizAttempt.updateMany({
 *     where: { id, version: expected },
 *     data: { ...changes, version: { increment: 1 } },
 *   }));
 */
export async function occUpdate(run: () => Promise<{ count: number }>): Promise<void> {
  const { count } = await run();
  if (count === 0) {
    throw AppError.conflict('Resource was modified concurrently; please refetch and retry');
  }
}

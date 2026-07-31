import { redis } from '../lib/redis';

function leaderboardKey(quizId: string): string {
  return `leaderboard:quiz:${quizId}`;
}

/**
 * Record (or improve) a user's best score on a contest-mode quiz. `GT`
 * (Redis 6.2+) makes "keep the best" a one-liner: the write is a no-op if the
 * member's existing score is already >= the new one, so a caller can invoke
 * this on every submission (including redeliveries) with no read-compare-
 * write dance and no idempotency guard of its own — see the events worker.
 */
export async function recordScore(quizId: string, userId: string, score: number): Promise<void> {
  await redis.zadd(leaderboardKey(quizId), 'GT', 'CH', score, userId);
}

export interface LeaderboardEntry {
  userId: string;
  score: number;
  rank: number; // 1-based
}

export async function getLeaderboard(quizId: string, limit = 20): Promise<LeaderboardEntry[]> {
  const raw = await redis.zrevrange(leaderboardKey(quizId), 0, limit - 1, 'WITHSCORES');
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ userId: raw[i] as string, score: Number(raw[i + 1]), rank: i / 2 + 1 });
  }
  return entries;
}

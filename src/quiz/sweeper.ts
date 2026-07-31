import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const POLL_INTERVAL_MS = 5_000;

/**
 * Some attempts are simply abandoned — a closed tab, a dropped connection —
 * and nobody ever calls `submitAttempt` for them, so they'd sit IN_PROGRESS
 * forever without this. This sweep is RECONCILIATION, not a business
 * trigger: it periodically flips any attempt whose server-set deadline has
 * already passed to EXPIRED (scored 0), the same terminal state
 * `submitAttempt` (Task 9.3) applies when it independently notices a late
 * submission — this just catches the ones nobody ever tried to submit.
 */
async function sweepOnce(): Promise<number> {
  const result = await prisma.quizAttempt.updateMany({
    where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date() } },
    data: { status: 'EXPIRED', submittedAt: new Date(), score: 0 },
  });
  return result.count;
}

export interface QuizSweeper {
  stop: () => Promise<void>;
}

/** Same poll-loop shape as the outbox relay (Task 7.3) — a simple interval with a graceful stop. */
export function startQuizSweeper(): QuizSweeper {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const count = await sweepOnce();
      if (count > 0) logger.info({ count }, 'quiz sweeper: expired abandoned attempts');
    } catch (err) {
      logger.error({ err }, 'quiz sweeper: tick failed — will retry next interval');
    }
    if (!stopped) timer = setTimeout(() => void (inFlight = tick()), POLL_INTERVAL_MS);
  }

  void (inFlight = tick());

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}

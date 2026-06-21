/**
 * Readiness check registry.
 *
 * Liveness ("am I alive?") needs no dependencies. Readiness ("can I serve
 * traffic right now?") depends on downstreams — DB, cache, etc. Rather than
 * hard-code those here, modules register their own check as they're added
 * (Postgres in Phase 1, Redis in Phase 4), keeping this file dependency-free.
 */
export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>; // resolve = healthy, throw/reject = unhealthy
}

export interface CheckResult {
  name: string;
  status: 'up' | 'down';
  error?: string;
}

const checks: ReadinessCheck[] = [];

/** Register a dependency check (called by modules during startup wiring). */
export function registerReadinessCheck(check: ReadinessCheck): void {
  checks.push(check);
}

/** Run all checks in parallel; healthy only if every check passes. */
export async function runReadinessChecks(): Promise<{ healthy: boolean; checks: CheckResult[] }> {
  const results = await Promise.all(
    checks.map(async ({ name, check }): Promise<CheckResult> => {
      try {
        await check();
        return { name, status: 'up' };
      } catch (err) {
        return { name, status: 'down', error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return { healthy: results.every((r) => r.status === 'up'), checks: results };
}

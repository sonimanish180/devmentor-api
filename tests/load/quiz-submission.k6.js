import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * k6 load test (Task 13.4) exercising the two write paths this project has
 * spent the most effort making safe under concurrency: lesson completion
 * (Task 5.3's transaction + Task 5.1's idempotency) and the quiz
 * start -> submit flow (Phase 9's server-authoritative timing + OCC).
 *
 * IMPORTANT — this is categorically different from every other test file in
 * `tests/`: k6 is its own runtime (a separate Go binary, not part of the
 * Node/vitest process), and it makes REAL network requests to an ALREADY
 * RUNNING devmentor-api. Task 13.1's Testcontainers harness (which spins up
 * disposable Postgres/Redis for `pnpm test:integration`) cannot provision
 * anything for this file — you need `docker compose up -d`, `pnpm db:seed`,
 * and `pnpm dev` (or a real deployed instance) already running before k6 has
 * anything to hit.
 *
 * Run with (k6 installed separately — https://k6.io/docs/get-started/installation/):
 *   BASE_URL=http://localhost:4000 \
 *   TEST_LESSON_ID=<intro lesson id> \
 *   TEST_QUIZ_ID=<the seeded 'next-steps' quiz id> \
 *   k6 run tests/load/quiz-submission.k6.js
 *
 * `pnpm db:seed` (Task 13.4) now creates a published, 300-second Quiz on the
 * 'next-steps' lesson specifically so this script has somewhere to point
 * without any manual DB setup — query for its id (or the lesson's) via
 * `pnpm db:studio` or a one-off `SELECT` if you don't already have it.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const TEST_LESSON_ID = __ENV.TEST_LESSON_ID;
const TEST_QUIZ_ID = __ENV.TEST_QUIZ_ID;

// Custom metrics mirroring docs/observability/slos.md's SLIs — running this
// against a live process lets you compare k6's OWN measurement of the same
// traffic against what Prometheus/Grafana (Task 12.2/12.3) report for it,
// which is a good way to sanity-check the metrics pipeline itself.
export const quizSubmissionErrors = new Rate('quiz_submission_errors');
export const quizSubmissionDuration = new Trend('quiz_submission_duration', true);

export const options = {
  scenarios: {
    quiz_flow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 }, // ramp up
        { duration: '1m', target: 20 }, // hold
        { duration: '30s', target: 0 }, // ramp down
      ],
    },
  },
  thresholds: {
    // Deliberately the SAME numbers as the Availability/Latency SLOs in
    // docs/observability/slos.md (99.5% availability, 95% under ~300ms) — a
    // load test with its own, different bar would tell you nothing about
    // whether the SLO itself is realistic under load.
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.005'],
    quiz_submission_errors: ['rate<0.01'],
  },
};

function uniqueEmail() {
  return `k6-${Date.now()}-${__VU}-${__ITER}@example.com`;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default function () {
  const email = uniqueEmail();
  const password = 'correct horse battery staple';

  // Register a fresh user per iteration — the load we actually care about is
  // "many independent learners hitting these endpoints," not "one account
  // hammering itself," and it sidesteps the refresh-token rotation/reuse
  // machinery (Task 3.4) entirely, which isn't what this test is measuring.
  const registerRes = http.post(`${BASE_URL}/api/v1/auth/register`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
  });
  const registered = check(registerRes, { 'register succeeded (201)': (r) => r.status === 201 });
  if (!registered) return; // no token to proceed with — count the failure and move on

  const accessToken = registerRes.json('accessToken');
  const authHeaders = { headers: { ...JSON_HEADERS, Authorization: `Bearer ${accessToken}` } };

  // Lesson completion — the simpler, non-timed write path (Task 5.3).
  const completeRes = http.post(`${BASE_URL}/api/v1/progress/lessons/${TEST_LESSON_ID}/complete`, null, authHeaders);
  check(completeRes, { 'lesson complete accepted (200/201)': (r) => r.status === 200 || r.status === 201 });

  // Quiz start -> submit — the path this load test exists for: does the
  // server-authoritative deadline + OCC-guarded submit (Phase 9) hold up
  // under sustained concurrent load, not just the small, fixed-N
  // Promise.all races Tasks 9.6/13.3 already cover functionally.
  const startRes = http.post(`${BASE_URL}/api/v1/quizzes/${TEST_QUIZ_ID}/start`, null, authHeaders);
  const started = check(startRes, { 'quiz start succeeded (201)': (r) => r.status === 201 });
  if (!started) return;

  const { attemptId, questions } = startRes.json();
  const answers = (questions || []).map((q) => ({ questionId: q.id, selectedIndex: 0 }));

  const submitStart = Date.now();
  const submitRes = http.post(
    `${BASE_URL}/api/v1/quizzes/attempts/${attemptId}/submit`,
    JSON.stringify({ answers }),
    authHeaders,
  );
  quizSubmissionDuration.add(Date.now() - submitStart);

  const submitOk = check(submitRes, { 'quiz submit succeeded (200/201)': (r) => r.status === 200 || r.status === 201 });
  quizSubmissionErrors.add(!submitOk);

  sleep(1); // a beat between iterations — this VU represents one learner, not a tight retry loop
}

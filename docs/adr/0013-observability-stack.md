# ADR-0013: Observability stack — OpenTelemetry tracing, Prometheus/Grafana metrics, SLO-based alerting

- Status: Accepted
- Date: 2026-08-19
- Phase: 12 — Observability & Operations
- Deciders: DevMentor team

## Problem

The system now spans a request handler, a Postgres write, an outbox row, two independent relays (BullMQ,
Kafka), queue workers, and multiple subscribers — across processes and, in production, across replicas.
Structured logs (Task 0.3) and correlation ids answer "what happened in this one request," but nothing today
connects a request to the async work it triggers later, shows system-wide health at a glance, or tells
anyone when something is quietly degrading before a user complains. Three separate but related questions
need answers: what happened to *this* request (tracing), how healthy is the system *in aggregate* right now
(metrics), and *when should a human be told* something is wrong (alerting on an explicit target, not vibes).

## Options considered

**Tracing:**
1. **OpenTelemetry SDK + auto-instrumentation, exported to Jaeger** — vendor-neutral, standard semantic
   conventions, auto-patches `http`/`express`/`ioredis`, a `@prisma/instrumentation` package for DB spans;
   Jaeger is a simple, well-known local trace store/UI. (chosen)
2. **A vendor-specific APM agent (Datadog, New Relic, etc.)** — often richer out-of-the-box UX, but locks the
   codebase into one vendor's SDK and format, and costs money before the project has any users to justify it.
3. **Hand-rolled span/timing logs** — zero new infrastructure, but reinvents (poorly) what OpenTelemetry
   already standardizes: span context, parent/child relationships, cross-process propagation.

**Metrics:**
1. **`prom-client` + a `/metrics` endpoint, scraped by Prometheus (pull model)** — the app stays simple
   (increment counters), Prometheus owns polling cadence, storage, and query language (PromQL); Grafana reads
   from Prometheus for dashboards. Industry-standard, free, self-hostable. (chosen)
2. **Push-based metrics (StatsD/a hosted APM's metrics pipeline)** — real-time, but adds an always-on network
   dependency to the request path and, for hosted options, a recurring cost.
3. **Metrics derived from log aggregation after the fact** — no new infrastructure, but expensive to query at
   read time and too slow for the sub-minute feedback loop alerting needs.

**Alerting:**
1. **SLO-based, multi-window multi-burn-rate alerts (SRE workbook approach)** — alerts fire based on how fast
   an explicit error budget is being consumed, at more than one severity/urgency. Requires deciding SLIs/SLOs
   up front. (chosen)
2. **Fixed-threshold alerts ("page if error rate > X for Y minutes")** — simple to write, but one threshold
   can't be simultaneously fast enough to catch a severe outage and quiet enough to ignore ordinary noise.
3. **No formal alerting yet, dashboards only** — fastest to ship, but means every incident is discovered by a
   user complaint or a human staring at a dashboard, not the system telling anyone.

## Decision

Adopt all three, deliberately connected rather than three unrelated tools:

**Tracing (Task 12.1).** `@opentelemetry/sdk-node` with `getNodeAutoInstrumentations` + `@prisma/instrumentation`
(needs `previewFeatures = ["tracing"]`), imported as the literal first line of every entrypoint (`server.ts`,
`worker.ts`) since auto-instrumentation patches modules at `require` time. Exports over OTLP/HTTP to a local
Jaeger all-in-one container. The one genuinely hard problem — the outbox is an **async boundary** that
automatic context propagation cannot cross — is solved with an explicit `traceCarrier` column on
`OutboxEvent`: `propagation.inject` captures the active span's context at write time, both relays forward it
untouched, and a subscriber's `propagation.extract` + `runWithLinkedTrace` continues the same trace as a
child span. Logs correlate to traces via a pino `mixin()` that stamps the active span's `traceId`/`spanId`
onto every log line.

**Metrics (Task 12.2).** `prom-client` on a dedicated `Registry`, exposed at `GET /metrics` (unauthenticated,
un-rate-limited, same posture as `/health`/`/ready`). **RED** (Rate/Errors/Duration) for the HTTP layer via a
`metricsMiddleware`, labeled by method + matched **route template** (never a raw URL — unbounded cardinality
would eventually crash Prometheus). **USE** (Utilization/Saturation/Errors) for the worker layer via a
`queue_depth` gauge, *polled* every 5s (there's no "event" to hook for queue depth) from the API process,
which already holds `Queue` client instances read-only. `collectDefaultMetrics` adds process/event-loop
metrics for free.

**SLOs & alerting (Task 12.3).** Three explicit SLIs, each a genuinely different failure shape: Availability
(non-5xx proportion, 99.5%/30d SLO), Latency (proportion under ~300ms via the Histogram, 95%/30d SLO), and a
system-specific **Freshness** SLI — age of the oldest undispatched `OutboxEvent` row per relay sink
(`bullmq`/`kafka`), because a slow async pipeline is invisible at the HTTP layer (the write already returned
201) yet still means real user-facing effects are late. Availability alerting uses **multi-window,
multi-burn-rate** rules (14.4x/1h+5m → page; 6x/6h+30m → ticket); Freshness alerts on a direct gauge
threshold per sink since there's no rate to burn. Grafana (`grafana/dashboards/devmentor-api.json`,
provisioned automatically alongside its Prometheus datasource) gives every one of these numbers a
corresponding graph.

## Consequences

- **+** A trace in Jaeger and a log line in the aggregator can point at each other (via `traceId`), and a
  trace can be followed from an HTTP request straight through a queue hop into a background worker —
  something none of Phases 0–11's per-request correlation ids could do on their own.
- **+** `/metrics` + Grafana give a single, always-current picture of system health across the HTTP, queue,
  and outbox-relay layers, in one place, without querying logs.
- **+** Alerting is tied to an explicit, written-down target (an SLO) rather than an arbitrary threshold
  someone picked once and never revisited — and the multi-window burn-rate shape means severe issues page
  fast while mild sustained ones don't get lost, without either flooding alerts on noise.
- **−** Three new pieces of local infrastructure (Jaeger, Prometheus, Grafana) join Postgres/Redis/Kafka in
  `docker-compose.yml` — more to run locally, though all three are dev-only, in-memory/ephemeral-friendly,
  and (per Task 0.7's established pattern) started with the same one `docker compose up -d`.
- **−** Only ONE subscriber (`handleLessonCompleted`) is wrapped in `runWithLinkedTrace` so far — extending
  the pattern to every event subscriber is the same one-line change, deliberately left as scoped follow-up
  rather than done reflexively everywhere in one pass, to keep the (currently entirely unverified — see the
  environment note below) surface area bounded.
- **−** This dev Prometheus has no Alertmanager wired up — alert *firing state* is visible at
  `http://localhost:9090/alerts`, but nothing actually pages/notifies a human yet; that's the natural next
  piece alongside a real on-call rotation, out of scope for a local dev stack.
- **Revisit when:** running more than one region/replica set makes single-instance-scoped dashboards
  insufficient (would need per-instance and aggregate views); when Alertmanager + a real notification channel
  (PagerDuty/Slack) is worth standing up; or when Jaeger's in-memory storage (traces vanish on restart) needs
  replacing with a durable backend for production.

## Environment note

Every file in Phases 7 through 12 — including everything in this ADR — was written and reviewed in a sandbox
where the shell has been non-functional since partway through Phase 7 (disk-space/RPC failures blocking
`pnpm`, `docker`, and `prisma` entirely) and where Docker was never runnable in the first place. Nothing in
this stack — the OTel SDK wiring, the `/metrics` endpoint, the Prometheus scrape/alert rules, or the Grafana
provisioning — has been executed even once. A full host-side verification pass (`pnpm install`, `docker
compose up -d`, exercising the API+worker, checking Jaeger/Prometheus/Grafana actually come up healthy and
show real data) is recommended before relying on any of Phases 7–12 in practice.

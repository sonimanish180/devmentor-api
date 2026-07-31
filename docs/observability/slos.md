# SLOs, SLIs & Alerting — devmentor-api

Captured at Task 12.3. Builds directly on the metrics from Task 12.2
(`http_requests_total`, `http_request_duration_seconds`, `queue_depth`,
`outbox_oldest_pending_age_seconds`) — this doc is the "so what do we actually
alert on" answer to those numbers, not a new instrumentation effort.

## Vocabulary (so the rest of this doc is unambiguous)

- **SLI (Service Level Indicator)** — a *measurement*: a number computed from metrics, e.g. "the proportion
  of requests in the last 5 minutes that returned a non-5xx status."
- **SLO (Service Level Objective)** — a *target* for an SLI over a window, e.g. "99.5% of requests over a
  rolling 30 days are non-5xx." An SLO is a promise to yourself/your team, not (necessarily) a contract with
  a customer.
- **SLA (Service Level Agreement)** — an SLO with a contractual consequence attached (a refund, a credit) if
  missed. devmentor-api has SLOs, not SLAs — there's no customer contract yet.
- **Error budget** — `1 - SLO` of allowed failure over the window. A 99.5% availability SLO over 30 days
  allows `0.5% × 30 days ≈ 3.6 hours` of "budget" to spend on outages, risky deploys, or accepted
  degradation. The budget existing is the point: it turns "never fail" (impossible, and a reason to avoid
  ever shipping) into a concrete, spendable number.
- **Burn rate** — how fast the error budget is being consumed, relative to the rate that would exactly
  exhaust it by the end of the window. A burn rate of 1 means "on pace to exhaust the budget exactly at the
  window's end." A burn rate of 14.4 over one hour means "at this rate, the entire 30-day budget is gone in
  about 2 days" — the basis for the alerting thresholds below.

## Chosen SLIs

Three, deliberately covering three different failure shapes: is the API answering correctly (Availability),
is it answering fast enough (Latency), and — because this system is event-driven, not just request/response
— is the async side keeping up (Freshness). RED/USE (Task 12.2) describe what to *measure*; an SLO decides
which of those measurements is worth promising a number on and alerting a human over.

### 1. Availability — "requests succeed"

**SLI:** proportion of HTTP requests in a window that do **not** return a 5xx status.

```promql
sum(rate(http_requests_total{status!~"5.."}[5m]))
  /
sum(rate(http_requests_total[5m]))
```

**SLO: 99.5% over a rolling 30 days.** Not 99.99% — this is a single-region, pre-scale service (no
multi-region failover yet, per ADR-0001/ADR-0007's phased-adoption philosophy), so an aspirational
five-nines target would be fiction. 99.5% ≈ 3.6 hours/month of allowed 5xx-heavy time, which comfortably
covers a bad deploy that gets rolled back within its normal detection window.

### 2. Latency — "requests succeed fast enough to feel responsive"

**SLI:** proportion of requests completing under a 300ms threshold.

```promql
sum(rate(http_request_duration_seconds_bucket{le="0.25"}[5m]))
  /
sum(rate(http_request_duration_seconds_count[5m]))
```
(Using the `le="0.25"` bucket as the closest one at-or-under the 300ms target — see the Pitfalls note on
picking bucket boundaries that actually match your SLO threshold.)

**SLO: 95% of requests under 300ms, over a rolling 30 days.** A p95-style target, not p50/average, for the
same reason a Histogram replaced an average in Task 12.2: the SLO should reflect what a meaningfully-sized
slice of *real users* experience, not the typical-case number that hides a bad tail.

### 3. Freshness — "events get processed, not just accepted"

**SLI:** age of the oldest not-yet-dispatched `OutboxEvent` row, per sink.

```promql
outbox_oldest_pending_age_seconds
```
(Already a point-in-time gauge, not a rate — no `rate()`/window needed to read "how stale is the oldest
pending event right now.")

**SLO: the oldest pending event is under 60 seconds old, at least 99.9% of the time, per sink.** This is the
one SLO that is genuinely new territory versus a typical request/response service: a slow HTTP response is
felt immediately by one user; a backed-up outbox relay is *invisible* at the HTTP layer (the write already
returned 201) but means XP awards, notifications, and search-index updates are all silently late for
everyone. Tracking it per sink (bullmq vs kafka) matters because Phase 10 made the two relays fully
independent — a stalled Kafka consumer must not be masked by BullMQ still keeping up, or vice versa.

## Alerting: multi-window, multi-burn-rate

A single "SLI dropped below SLO, alert now" rule has a bad trade-off: thresholds tight enough to catch a
brief real outage fire on ordinary noise, and thresholds loose enough to avoid noise miss real outages until
much of the budget is already gone. The fix (following the Google SRE workbook's approach) is pairing a
**short window** (catches fast, severe burn — page immediately) with a **long window** (catches slow, sustained
burn — ticket, not a 3am page) for the *same* SLI, each requiring the burn rate to be sustained across two
window lengths (a fast one and 1/12th of it) to suppress single-scrape blips.

```yaml
# prometheus-alerts.yml — burn-rate alerts for the Availability SLO (99.5% / 30d)
groups:
  - name: devmentor-api-availability-slo
    rules:
      # Fast burn: 14.4x the sustainable rate would exhaust a 30-day budget in ~2 days.
      # Requires both a 1h AND a 5m window over the threshold — cuts noise from a single bad minute.
      - alert: AvailabilitySLOFastBurn
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[1h])) / sum(rate(http_requests_total[1h])) > (14.4 * 0.005)
          )
          and
          (
            sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > (14.4 * 0.005)
          )
        for: 2m
        labels: { severity: page }
        annotations:
          summary: "Availability SLO burning ~14.4x sustainable rate — budget exhausted in ~2 days at this rate"

      # Slow burn: 6x the sustainable rate would exhaust the budget in ~5 days — real, but not a page-now situation.
      - alert: AvailabilitySLOSlowBurn
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[6h])) / sum(rate(http_requests_total[6h])) > (6 * 0.005)
          )
          and
          (
            sum(rate(http_requests_total{status=~"5.."}[30m])) / sum(rate(http_requests_total[30m])) > (6 * 0.005)
          )
        for: 15m
        labels: { severity: ticket }
        annotations:
          summary: "Availability SLO burning ~6x sustainable rate — budget exhausted in ~5 days at this rate"

  - name: devmentor-api-freshness-slo
    rules:
      # Freshness has no "rate" to burn — alert directly on the gauge crossing the SLO threshold,
      # sustained, per sink (so a stuck Kafka consumer doesn't get averaged away by a healthy BullMQ relay).
      - alert: OutboxRelayLagging
        expr: outbox_oldest_pending_age_seconds > 60
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "{{ $labels.sink }} outbox relay hasn't dispatched a >60s-old event — consumer/relay likely stuck"
```

This file is mounted into Prometheus at `/etc/prometheus/rules.yml` and referenced from `prometheus.yml`'s
`rule_files:`; Prometheus itself only *evaluates* the rules and exposes their firing state (visible at
`http://localhost:9090/alerts`) — this dev setup has no Alertmanager wired in to actually page/notify
anyone yet, which would be the natural next step alongside a real on-call rotation.

## Dashboards

`grafana/dashboards/devmentor-api.json` (provisioned automatically — see `docker-compose.yml`'s `grafana`
service) has one panel per SLI above (request rate split by status class, p50/p95/p99 latency, outbox lag
per sink) plus the USE signals from Task 12.2 (queue depth per queue/state, Node.js event loop lag from
`collectDefaultMetrics`). Panels mirror the PromQL in this doc exactly, so "what does the alert mean" always
has a corresponding graph to open, not just a paged number.

## Pitfalls

Picking a latency **bucket boundary that doesn't match the SLO threshold** silently produces a wrong number
— `histogram_quantile`/bucket-ratio math can only be as precise as the buckets actually defined in Task
12.2's Histogram, so an SLO threshold should be chosen to land on (or very close to) an existing bucket, not
picked independently and reconciled later. An error budget that's never spent isn't a sign of excellence —
it usually means the SLO was set too loose, or the team is being too conservative about shipping (the
budget existing is supposed to *permit* some risk). A single-window alert threshold is not a substitute for
multi-window burn-rate alerts — it will either fire on noise or miss slow leaks; use both a short and long
window per rule. Freshness SLOs need their own alert shape (a gauge threshold, not a burn-rate ratio) — don't
force every SLI into the same ratio-based alerting math just for consistency.

## Quiz idea

*Why does the availability alerting use TWO burn-rate rules (14.4x/1h+5m and 6x/6h+30m) instead of one rule
that fires whenever the error rate exceeds the plain 0.5% SLO threshold?* → A single fixed-threshold rule
forces an impossible trade-off: tight enough to catch a real fast outage quickly means it also fires on
ordinary noise, while loose enough to avoid noise means a real outage burns through most of the error budget
before anyone is paged. Multiple burn-rate multiples, each confirmed across two window lengths, let a severe
short-lived spike page immediately while a milder sustained leak is caught before the budget is gone, without
either one flooding alerts on single-scrape blips.

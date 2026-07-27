# ADR-0005: Redis cache-aside for read performance

- Status: Accepted
- Date: 2026-06-21
- Phase: 4 — Caching & Read Performance
- Deciders: DevMentor team

## Problem

The course catalog and lesson reads are hot, identical across users, and change rarely, but every request
hits Postgres. As we scale horizontally we need to cut read load and latency — with a cache that works
across multiple API instances and can be invalidated cluster-wide.

## Options considered

1. **No cache** — scale Postgres (bigger instance, read replicas). Simple, but costly and ultimately the
   bottleneck for trivially cacheable reads.
2. **In-process memory cache** — fastest and zero infra, but **per-replica**: low hit rate across instances,
   lost on restart, and impossible to invalidate on other replicas.
3. **Redis (shared cache), cache-aside** — one cache all instances share, TTLs, atomic ops for locks, and
   pub/sub for later. (chosen)

## Decision

Add **Redis** and a **cache-aside** helper for hot reads, with two-layer **stampede protection**
(in-process single-flight + a Redis `SET NX` lock) and **event-driven invalidation** (delete specific keys +
SCAN-clear collection prefixes). Public GETs also send `Cache-Control` and rely on Express's ETag/304 for
client/CDN caching. Redis is wired into readiness and graceful shutdown. This is also the shared
infrastructure that later phases (distributed rate limiting, locks, pub/sub, queues) build on.

## Consequences

- **+** Big cut in DB read load/latency; shared across all replicas; cluster-wide invalidation; foundation
  for locks/pub-sub/queues later.
- **+** Stampede protection prevents a hot-key expiry from becoming a DB spike.
- **−** A new stateful dependency to run and monitor; caching adds staleness (bounded by TTL + invalidation).
- **−** Cached JSON loses types (Dates → strings); consistent over HTTP but a footgun in code.
- **Revisit when:** we need read-through/write-through semantics, per-entity fine-grained invalidation, or a
  second-level/edge cache (CDN) for anonymous traffic.

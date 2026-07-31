# ADR-0012: Postgres full-text search (not a dedicated search engine, yet)

- Status: Accepted
- Date: 2026-08-14
- Phase: 11 — Search & Content Delivery
- Deciders: DevMentor team

## Problem

Learners need to find courses and lessons by free-text query, ranked by relevance, not just browse the
catalog tree. We already run Postgres for everything else; the question is whether catalog-scale search
needs a dedicated search engine (Elasticsearch, Meilisearch, Typesense) from day one, or whether Postgres's
built-in full-text search is enough for now — and, if so, where that stops being true.

## Options considered

1. **Postgres full-text search (`tsvector`/`tsquery`, generated columns, GIN indexes)** — no new
   infrastructure; the data we're searching already lives here. Weaker relevance tuning and no built-in
   faceting/typo-tolerance compared to a dedicated engine, but those aren't requirements yet. (chosen)
2. **A dedicated search engine (Elasticsearch/Meilisearch/Typesense)** — much richer relevance tuning,
   faceted search, typo tolerance, and horizontal scalability purpose-built for search — but a new stateful
   service to run, operate, and keep in sync with Postgres, for a catalog that's currently a few hundred to a
   few thousand rows, not millions.
3. **Client-side filtering (fetch everything, filter in the browser)** — zero backend work, but doesn't
   scale past a tiny catalog and can't rank by relevance meaningfully.

## Decision

Use **Postgres full-text search**. `Course` and `Lesson` each get a `GENERATED ALWAYS AS ... STORED`
`tsvector` column (from title + description) with a GIN index — Postgres keeps these in sync on every write,
with zero application code (Task 11.1). The search endpoint (Task 11.2) is a single `UNION ALL` query across
both tables, ranked by `ts_rank` (plus a small popularity boost for lessons), with pagination and the total
count computed by Postgres itself (`COUNT(*) OVER()`), not merged/sorted in application code. Deliberately
**offset**-paginated, not keyset — the sort key is a computed, floating-point rank with no stable column to
build a cursor from, and search result sets are small enough in practice that offset's O(n) cost at depth
never matters. A denormalized `SearchIndexEntry` read model (Task 11.3) adds a popularity signal
(`completionCount`) fed incrementally by real `LessonCompleted` events via the Kafka search-index-consumer
scaffolded in Phase 10 — finally given real behavior.

### Graduation criteria — move to a dedicated search engine when we need:

- **relevance tuning** beyond `ts_rank` (field weighting, custom scoring functions, learning-to-rank);
- **typo tolerance / fuzzy matching** at a quality Postgres's trigram extension doesn't comfortably reach;
- **faceted search** (filter-and-count by level, duration, tags, simultaneously, fast, at scale);
- **catalog size** where GIN index maintenance or query latency on a single Postgres instance becomes the
  bottleneck (the same "criteria, not vibes" discipline ADR-0007 and ADR-0011 already established for
  BullMQ→Kafka).

## Consequences

- **+** Zero new infrastructure — search reuses the database we already run, operate, and back up.
- **+** The generated `tsvector` columns need no application code to stay in sync; Postgres maintains them
  on every write to `title`/`description`, the same "let the database do it" philosophy that made pagination
  keysets and OCC version columns simple in earlier phases.
- **+** A single ranked, paginated query (rather than N queries merged in JS) keeps sorting and pagination
  correct and in the database, where indexes can actually help.
- **−** Prisma's schema DSL can't express a `GENERATED` tsvector expression or its GIN index — both are
  hand-written raw SQL in the migration, a real (if narrow) gap in the ORM's coverage, consistent with
  `FOR UPDATE SKIP LOCKED` needing the same escape hatch in Phase 7.
- **−** Relevance quality is what `ts_rank` gives you — no typo tolerance, no field-weighting beyond what we
  hand-tune, no learning-to-rank. Acceptable for a course catalog; a genuinely large, query-diverse content
  library would outgrow it.
- **−** The search read model's descriptive content is rebuilt in bulk (no content-authoring event stream
  exists yet), while only its ranking signal is event-driven — a real, deliberate compromise given what
  events actually exist today, not the "fully event-sourced" ideal; documented so a future content-management
  API knows exactly what it needs to add (an event on course/lesson change, consumed the same way).
- **Revisit when:** any graduation criterion above is met — and note the migration path is short, since the
  Kafka `domain-events` stream (Phase 10) already carries everything a dedicated search engine's indexer
  would need to consume, independently, in its own consumer group.

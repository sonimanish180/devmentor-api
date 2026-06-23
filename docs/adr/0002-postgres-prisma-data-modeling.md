# ADR-0002: PostgreSQL + Prisma, normalized structure with JSONB content

- Status: Accepted
- Date: 2026-06-21
- Phase: 1 — Data Modeling & Persistence
- Deciders: DevMentor team

## Problem

The service must persist users, their progress, and a catalog of many courses with deep, varied
content, plus quizzes and timed attempts later. We need: strong integrity for relationships
(a lesson belongs to a module belongs to a course), the ability to query/order/paginate the catalog,
flexibility for content whose *shape* evolves, and idempotent progress writes (a double-click must not
double-count). We must pick a database, a data-access layer, and a modeling approach.

## Options considered

**Database**
1. **PostgreSQL** — relational integrity, transactions, rich indexing, and **JSONB** for flexible blobs when needed. (chosen)
2. MongoDB — flexible documents, but weaker relational integrity for our highly-related data, and the curriculum's relations (course→module→lesson, progress joins) map naturally to SQL.

**Data-access layer**
1. **Prisma** — typed client generated from a schema, first-class migrations, readable queries. (chosen)
2. Knex / raw SQL — more control, but manual typing and migrations; more boilerplate to teach safely.

**Modeling approach**
1. Fully normalized (every content block a row) — queryable, but a migration per new block type and heavy joins.
2. Fully document (whole course as one JSON) — flexible, but loses ordering/filtering/integrity.
3. **Hybrid: normalize structure, store lesson content as JSONB** — query the tree, keep content flexible. (chosen)

## Decision

- **PostgreSQL + Prisma.**
- **Normalize** `Course → Module → Lesson` with FKs, ordering, unique slugs per parent, and indexes; store each lesson's `blocks`/`quiz` as **JSONB** (no migration to add a block type).
- Model progress (`LessonCompletion`, `QuizScore`) as **join tables with composite primary keys** so writes are idempotent (`upsert` / `ON CONFLICT DO NOTHING`).
- One shared `PrismaClient`; versioned migrations (`migrate dev`/`deploy`); idempotent seed.

## Consequences

- **+** Integrity, transactions, and queryable/paginable catalog; content stays flexible; progress writes are naturally idempotent — a foundation Phase 5 (concurrency) builds on directly.
- **+** Typed queries and migrations reduce a whole class of bugs.
- **−** JSONB is opaque to SQL constraints, so content shape must be validated in the app (zod) before write.
- **−** Prisma adds a generate step and some abstraction over raw SQL.
- **Revisit when:** a hot read path needs denormalized read models (Phase 11 search/CQRS), or extreme write volume needs partitioning/sharding (Phase 15).

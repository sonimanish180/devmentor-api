# ADR-0003: REST as the API style (over GraphQL / tRPC)

- Status: Accepted
- Date: 2026-06-21
- Phase: 2 — API Design & Validation
- Deciders: DevMentor team

## Problem

We need to choose how clients talk to the backend. The choice shapes routing, validation, caching,
documentation, tooling, and how easy the API is to consume from web, future mobile, and third parties.

## Options considered

1. **REST over HTTP** — resources + HTTP verbs, versioned URLs, cacheable GETs, universally understood,
   easy to document with OpenAPI and to consume from anything. Can over/under-fetch and need multiple
   round-trips for nested data. (chosen)
2. **GraphQL** — clients fetch exactly what they need in one request; great for complex, client-driven
   graphs. But adds a schema/resolver layer, complicates HTTP caching and rate limiting, and brings N+1
   and query-cost concerns we'd need to manage.
3. **tRPC** — end-to-end TypeScript types with no schema duplication; excellent DX for a TS monorepo. But
   it couples client and server to TypeScript/RPC, is less friendly to non-TS or third-party consumers, and
   isn't a language-neutral contract.

## Decision

**REST over HTTP**, versioned at `/api/v1`, documented by an **OpenAPI** contract, with **zod** validating
inputs at the edge and a single error envelope. Resources are plural nouns; verbs are HTTP methods; lists
are keyset-paginated. The catalog's nesting is handled with `include` (one query) and a list/detail split,
which addresses REST's over-fetching without changing paradigms.

## Consequences

- **+** Simplest to teach, document, cache, and consume from any client; OpenAPI gives docs + client generation; plays naturally with HTTP rate limiting and caching (Phase 4).
- **+** Language-neutral contract — good for future mobile/third-party consumers.
- **−** Some endpoints over/under-fetch vs GraphQL; mitigated with list/detail shaping and `include`.
- **−** No automatic end-to-end types like tRPC; we recover most of that via OpenAPI-generated clients and shared zod DTOs.
- **Revisit when:** a client needs highly variable, deeply-nested selections at scale (consider a GraphQL gateway in front of these services), or the consumer set becomes a pure TS monorepo (tRPC for internal calls).

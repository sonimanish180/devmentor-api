# ADR-0001: Foundational stack & project shape

- Status: Accepted
- Date: 2026-06-21
- Phase: 0 — Foundations & Project Setup
- Deciders: DevMentor team

## Problem

We're starting `devmentor-api` from zero and need to fix the foundational choices that everything
else builds on: runtime/framework, language & module system, package manager, and overall service
shape. These are expensive to change later, and the project doubles as a teaching artifact — so each
choice must be defensible and explainable, not just convenient.

## Options considered

**Framework**
1. Plain Node `http` — no deps, but we'd reinvent routing/middleware.
2. **Express** — ubiquitous, minimal, matches the patterns the DevMentor curriculum already teaches.
3. NestJS / Fastify — more structure (DI, modules) or more speed, but more abstraction to learn up front.

**Language & module system**
1. JavaScript — no build step, but no type safety.
2. **TypeScript (CommonJS output)** — type safety; CJS avoids ESM `.js`-extension import friction with a simple `tsc` build.
3. TypeScript (NodeNext ESM) — the modern standard, but the extension/loader friction is a teaching tax this early.

**Package manager:** npm vs **pnpm** vs yarn.

**Service shape:** **modular monolith** vs microservices (already argued in `devmentor-scalable-architecture.md`).

## Decision

- **Express + TypeScript**, compiled as **CommonJS**, run in dev with **tsx**.
- **pnpm** as the package manager.
- A **modular monolith**: one deployable service, hard-bounded modules under `src/modules/*`, talking via service interfaces/events (never cross-module table access) so any module can be extracted to its own service later.
- Cross-cutting building blocks chosen now: **zod** (config + input validation), **pino** (structured logs).

## Consequences

- **+** Fast to build, easy to teach, low abstraction; mirrors the curriculum; clean seams for future extraction.
- **+** CommonJS keeps imports/build friction near zero for learners.
- **−** Express 4 doesn't auto-catch async errors (mitigated with an `asyncHandler` wrapper).
- **−** CommonJS isn't the long-term modern default.
- **Revisit when:** we want ESM-only dependencies, or a module needs to scale/own deploy independently (extract it to its own service), or DI/structure pain justifies NestJS.

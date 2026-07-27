# ADR-0004: Custom JWT auth (over Auth.js / a managed provider)

- Status: Accepted
- Date: 2026-06-21
- Phase: 3 — Authentication & Security
- Deciders: DevMentor team

## Problem

The service needs authentication: accounts, login, protected endpoints, sessions that work across devices,
and role-based authorization — with sensible security defaults. How much do we build vs. adopt?

## Options considered

1. **Custom JWT (access + refresh) built in-house** — full control and maximum learning; we implement the
   exact dual-token pattern, rotation, reuse detection, and RBAC. More code to get right. (chosen)
2. **Auth.js (NextAuth)** — batteries-included auth with OAuth providers and session handling. Less code,
   but opinionated, tightly coupled to its session model, and heavier to run as a standalone API (it's
   framework-oriented).
3. **Managed provider (Clerk/Auth0/Supabase Auth)** — offload auth entirely; fastest to a login screen. But
   a third-party dependency, cost, vendor lock-in, and you don't learn/own the auth layer.

## Decision

**Custom JWT auth**: short-lived access JWTs (stateless verification), opaque refresh tokens stored **hashed**
with **rotation + reuse detection**, argon2id password hashing, a stateless `requireAuth` + `requireRole`
(RBAC), and hardening via helmet / CORS / rate limiting. This is the pattern the course teaches, and it keeps
the API self-contained and provider-independent.

## Consequences

- **+** Full control and understanding of the security-critical path; no third-party dependency or cost; the
  API is self-contained and easy to reason about.
- **+** The dual-token + rotation design gives revocable sessions with stateless request verification.
- **−** We own the security burden — bugs here are serious, so this area needs the most tests and review.
- **−** No built-in OAuth/social login; adding it later means integrating providers ourselves (or layering
  Auth.js/passport for the OAuth handshake while keeping our JWT session model).
- **Revisit when:** we need many OAuth providers / enterprise SSO (consider Auth.js or a managed provider for
  the identity layer), or instant global session revocation (add a token denylist / shorten TTLs, Phase 4 Redis).

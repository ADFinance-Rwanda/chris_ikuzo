# AI usage disclosure

## Tools used

GitHub Copilot in VS Code was used as an AI coding assistant while developing and reviewing this repository.

## Areas assisted

AI assistance was used for backend refactoring, schema and test scaffolding, Docker wiring, documentation structure, and frontend scaffolding. The resulting code was reviewed and adjusted in the repository, then checked with Node tests, a frontend production build, SQL/container configuration review, and a disposable-database integration test plan.

## Representative prompts

1. “Make task updates atomic using the version column and persist audit data in the same transaction.”
2. “Add tenant-safe composite foreign keys and tests for cross-tenant task access and writes.”
3. “Build a React interface using Keycloak authorization code flow with PKCE and protected API requests.”

These are representative paraphrases of the coding instructions used during this implementation, not a verbatim prompt log.

## Rejected or changed suggestions

- A process-local memory fallback for database failures was removed. It could return success-shaped responses while durable storage was unavailable and diverge across API replicas.
- Redis-only idempotency was replaced with a PostgreSQL uniqueness constraint and request digest. Concurrent retries must remain safe even when Redis is unavailable.
- An update flow that selected a version and then issued a separate update was replaced with one conditional `UPDATE ... WHERE version = ...`, so two concurrent writers cannot both succeed.
- Audit records were moved from a bounded Redis list into the same durable transaction as business mutations, with a database trigger that prevents row update/delete.

## Verification

The backend's built-in Node test runner covers token claim normalization, role hierarchy, authentication boundary, readiness behavior, and tenant middleware. A separate opt-in PostgreSQL suite covers tenant-safe CRUD, idempotency, concurrent stale versions, and immutable audit rows. The frontend is built with Vite. Integration assertions require an explicitly configured disposable `TEST_DATABASE_URL`; they must not be run against a database containing valuable data.

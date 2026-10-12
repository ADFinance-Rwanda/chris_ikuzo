# Architecture

## Components and request flow

```text
Browser (React / Keycloak JS)
  ├── OIDC authorization code + PKCE ──> Keycloak
  └── Bearer access token ──> Nginx frontend ──> Express API
                                                ├── PostgreSQL
                                                │    ├── tenant data
                                                │    ├── append-only audit log
                                                │    └── background job queue
                                                └── Redis
                                                     ├── API rate windows
                                                     └── 60-second analytics cache
Background worker ────────────────────────────────> PostgreSQL jobs
```

The frontend obtains an access token directly from Keycloak using a public client and PKCE. The API verifies the token signature using the Keycloak JWKS endpoint and checks the exact configured issuer and audience. Authentication middleware extracts the subject, role set, and organization claim. Tenant middleware binds the request scope from that signed claim before routes can access data.

Routes validate input with Zod and call repository methods. Repository queries include the authenticated `organization_id`. Composite database foreign keys ensure that task project and assignee references cannot cross tenant boundaries. A task mutation and its audit event commit in one PostgreSQL transaction. Task creation also inserts a durable notification job in that transaction.

## Redis

Rate limiting uses an atomic Redis Lua increment plus expiry for each authenticated tenant/user fixed window. Redis failure fails closed with a logged `503`; traffic is not silently allowed without the configured abuse control. Dashboard data is cached by organization and, for members, by user for 60 seconds. Cache errors are logged and analytics fall back to PostgreSQL; invalidation errors are logged and bounded by the TTL.

## Worker

The worker polls the PostgreSQL job table and claims work using `FOR UPDATE SKIP LOCKED`. It simulates notification delivery by inserting a row with a unique job ID and marks work complete transactionally. Jobs retry with capped exponential backoff and become `dead` after five attempts. A processing lock older than five minutes is reclaimable after worker loss.

## Scaling

The API and worker are stateless and can be replicated. PostgreSQL is the system of record; production deployment should add managed high availability, connection pooler, PITR, and measured query plans. Redis rate buckets are shared between API replicas. Cache key scans currently support invalidation for local scale; for high cardinality use versioned tenant cache keys or a targeted key registry rather than broad key scans. The worker can scale horizontally through `SKIP LOCKED`.

## Deliberate scope

The repository has one API, one worker process type, and one frontend. It does not introduce separate microservices. The database-backed notification is a demo sink and is not an external delivery guarantee.

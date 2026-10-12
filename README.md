# Taskline

A Dockerized multi-tenant project and task management reference application. The current implementation focuses on tenant isolation, conditional updates, durable PostgreSQL writes, Keycloak authentication, and operable local development.

## Stack

- React 19 + Vite frontend with Keycloak OIDC authorization-code flow and PKCE
- Node.js 20 / Express API
- PostgreSQL 16 for application data, audit history, and background jobs
- Redis 7 for rate limiting and short-lived dashboard caching
- Keycloak 26 for identity and realm roles
- Docker Compose for local orchestration

## Start locally

Prerequisites: Docker Desktop with Compose v2, Node.js 20+ (for tests/builds), and Bash (for the Keycloak bootstrap/backup scripts).

1. Copy `.env.example` to `.env`. Replace each `replace-with-...` value; keep the app DB password alphanumeric because Compose places it in a PostgreSQL URL.
2. Start the stack:

   ```sh
   docker compose up --build -d
   ```

   Compose starts PostgreSQL, Redis, Keycloak, the API, a worker, and the frontend at `http://localhost`.
3. Bootstrap the local Keycloak realm and demo account:

   ```sh
   bash scripts/bootstrap-keycloak.sh
   ```

   Sign in using `KEYCLOAK_DEMO_USERNAME` and `KEYCLOAK_DEMO_PASSWORD` from your local `.env`. The bootstrap assigns the seeded demo tenant and the `member` role. It configures a public frontend client with PKCE; no browser client secret is used.
4. Check `http://localhost/health`, `http://localhost:3000/ready`, and the frontend at `http://localhost`.

The database migrator runs before the API starts. Migrations are tracked in `schema_migrations`. The migration account is the PostgreSQL bootstrap user; the API and worker connect as the restricted `APP_DB_USER`.

## Useful commands

```sh
docker compose ps
docker compose logs -f backend worker
docker compose down
cd backend && npm test
cd frontend && npm run build
```

Integration tests use a **disposable PostgreSQL database** only:

```sh
$env:TEST_DATABASE_URL="postgres://test_user:test_password@localhost:5432/taskline_test"
npm run test:integration --prefix backend
```

Do not point `TEST_DATABASE_URL` at a database containing data you need. The integration runner applies migrations and then tests isolation, task CRUD, idempotency, simultaneous stale updates, and append-only audit behavior.

The project depends on several downloaded packages, so the accurate lockfiles are required in source control. In PowerShell, run `Set-Location backend; npm install; Set-Location ..\frontend; npm install` once to install them locally.

The Redis rate-limit integration test is opt-in too: set `TEST_REDIS_URL` to a disposable Redis instance before `npm test` in `backend/`. It verifies atomic increments and enforcement at the configured boundary.

## API overview

All `/api` endpoints require `Authorization: Bearer <Keycloak access token>`. The signed token must have the configured issuer and `app-backend` audience, a recognized role, and an organization claim (`org_id` by default). The server derives the tenant from that claim; client-provided tenant IDs never select the data scope.

| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/me` | Authenticated user with tenant |
| GET, POST | `/api/projects` | MEMBER+ read; PROJECT_MANAGER+ create |
| GET, PUT, DELETE | `/api/projects/:id` | MEMBER+ read; ORG_ADMIN+ update/delete |
| GET, POST | `/api/tasks` | MEMBER+ |
| GET, PUT | `/api/tasks/:id` | MEMBER+ |
| DELETE | `/api/tasks/:id` | PROJECT_MANAGER+ |
| GET | `/api/dashboard` | MEMBER+; members see only assigned/created tasks |
| GET | `/health`, `/ready` | Liveness and dependency readiness |

Task list filters: `status`, `priority`, `assignee_id`, `project_id`, `due_after`, `due_before`, `search`, `page`, `limit` (maximum 100). Member task lists are limited to tasks they created or are assigned. Update requests must include the current integer `version`; a stale version returns `409 VERSION_CONFLICT`. Task creation accepts `Idempotency-Key`; reusing it with the same payload returns the original task, while reusing it with a different payload returns 409.

Full route and schema details are in [`docs/openapi.yaml`](docs/openapi.yaml).

## Reliability and operations

- Rate limits are Redis-backed fixed windows. When Redis is unavailable, guarded API operations return `503 RATE_LIMITER_UNAVAILABLE` rather than silently disabling abuse controls. Dashboard cache read/write failures are logged and analytics are recomputed from PostgreSQL; failed invalidation leaves cached data stale for at most the 60-second TTL.
- Audit entries are written in the same transaction as task/project changes. Runtime DB users cannot bypass the append-only trigger or alter audit rows.
- Task-created background notifications are persisted as PostgreSQL jobs, claimed using `FOR UPDATE SKIP LOCKED`, retried with capped exponential delays, and moved to `dead` after five attempts. Delivery records are unique per job; delivery is simulated, not sent to an external provider.
- `scripts/backup.sh` creates a custom-format PostgreSQL dump. Restore requires explicit `CONFIRM_RESTORE=YES`; see [`DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md).
- `/health` is process liveness only. `/ready` checks PostgreSQL, Redis, and the Keycloak JWKS endpoint.

## Assessment status / limitations

This repository demonstrates the requested end-to-end core, not a production-ready hosted service. The single `org_id` claim represents one organization membership per token; organization creation, invitations, and Keycloak membership administration are not exposed as API operations. The background notification sink is a database-backed demonstration, not email delivery. Redis rate-limit unavailability intentionally fails closed, and requires operators to restore Redis for API traffic. The current automated PostgreSQL tests use a disposable database but do not spin up Keycloak or drive a browser-based end-to-end login. The SQL includes indexes and example `EXPLAIN` instructions; a representative production-volume benchmark remains to be run.

See [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`SECURITY.md`](docs/SECURITY.md), [`DATABASE.md`](docs/DATABASE.md), [`DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md), and [`AI_USAGE.md`](docs/AI_USAGE.md) for design rationale and remaining production considerations.

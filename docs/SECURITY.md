# Security

## Authentication

- Keycloak access tokens are verified through cached JWKS public keys.
- Verification pins `RS256`, the configured issuer, and the backend audience. `account` is not accepted as a substitute audience.
- The SPA is a public OIDC client and uses authorization code flow with PKCE (`S256`); it has no embedded client secret.
- Missing/invalid tokens return 401. Token validation failures do not return cryptographic error details.

## Tenant isolation

The API does not accept client tenant IDs as the authorization source. Middleware takes the organization UUID from the signed `org_id` token claim. Any tenant ID in path/query/body must match that scope or receives 403. Every project/task/audit query scopes by organization. Composite foreign keys pair a task's `organization_id` with its `project_id` and `assignee_id`, preventing cross-tenant relationships even if application code regresses.

Keycloak membership administration is outside the current API. The trusted identity provider must only issue `org_id` to members of that tenant. The sample bootstrap assigns a fixed demo organization; production provisioning must validate membership before issuing the claim.

## RBAC

Roles are normalized to `SUPER_ADMIN`, `ORG_ADMIN`, `PROJECT_MANAGER`, and `MEMBER`, with higher roles inheriting lower-role access within the token's tenant. Task readers/creators/updaters require MEMBER; task deletion requires PROJECT_MANAGER or above; project creation requires PROJECT_MANAGER or above; project update/deletion requires ORG_ADMIN or above. There is no cross-tenant super-admin organization-management endpoint in this submission.

## Data and request controls

- Zod strict request schemas reject unknown fields, server-controlled tenant IDs, invalid task state/priority, invalid UUIDs, and oversized text.
- SQL parameters are used for values; dynamic SQL identifiers come only from static server-side allowlists.
- Version-conditional task updates return 409 for stale writers.
- Task idempotency keys have a tenant-scoped unique constraint and a SHA-256 payload digest. Same key/same payload returns the existing task; changed payload under the same key is a 409.
- Audit writes commit with business writes. PostgreSQL triggers reject audit updates/deletes, and API/worker connect through a non-owner runtime role.
- Redis rate limiting uses an atomic Lua script, a user+tenant key, a fixed 60-second window, and route-specific limits. Redis unavailability fails closed with 503.
- CORS is allow-listed; request bodies are limited to 1 MiB. Request IDs are returned for diagnostics.

## Secrets, logs, and assumptions

Never commit `.env`; `.env.example` contains placeholders. Rotate sample credentials before use and use a managed secret store outside local development. Logs include request ID, method, path, and error code/message, but not bearer tokens, passwords, or request bodies. Database/Redis errors are not returned verbatim to callers.

The sample Compose setup uses Keycloak `start-dev`, local HTTP endpoints, and local-development passwords; it is not a production deployment. Production must use TLS, hardened Keycloak, managed secrets, database least privilege, network policies, backups/PITR, security monitoring, and a validated tenant provisioning flow.

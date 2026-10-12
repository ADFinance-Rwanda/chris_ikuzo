# Database

The schema is created by ordered SQL files in `database/migrations/`. `scripts/migrate.js` takes an advisory transaction lock, tracks versions in `schema_migrations`, and is invoked by the API container before it serves traffic.

## Entities

- `organizations` owns projects, tasks, users, audit rows, jobs, and deliveries.
- `projects` is unique by `(organization_id, id)`.
- `users` is keyed by Keycloak subject and uniquely addressable by `(organization_id, id)`.
- `tasks` references its project and optional assignee with composite tenant-aware foreign keys. Status, priority, version, and input lengths have database constraints.
- `task_audit_logs` records task/project mutations with JSON metadata. A trigger rejects updates/deletes.
- `background_jobs` and `notification_deliveries` provide a persistent, retryable demonstration queue with a unique delivery per job.

## Transactions and concurrency

Create, update, and delete task mutations and their audit records share a transaction. Task creation also records its notification job in that same transaction. Updates use:

```sql
UPDATE tasks
SET title = $4, version = version + 1, updated_at = NOW()
WHERE organization_id = $1 AND id = $2 AND version = $3
RETURNING *;
```

The route requires the caller's version. No row means either tenant-scoped not-found or a stale-version conflict; a follow-up tenant-scoped existence query distinguishes them. Concurrent writers with the same version cannot both win.

Idempotency uses `UNIQUE (organization_id, idempotency_key)` in PostgreSQL, not Redis. `INSERT ... ON CONFLICT DO NOTHING` followed by a same-transaction read resolves racing duplicate requests. A stored payload digest distinguishes safe replay from key reuse for a different request.

## Indexing

Indexes support organization plus recent task ordering, organization/project/status filters, organization/assignee, organization/due-date, project recency, audit chronology, and pending-job claims. Partial indexes omit null assignees/due dates and non-pending jobs.

Example plan to run against representative tenant data:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, status, priority, updated_at
FROM tasks
WHERE organization_id = '00000000-0000-4000-8000-000000000001'
  AND status = 'IN_PROGRESS'
ORDER BY updated_at DESC, id
LIMIT 50 OFFSET 0;
```

The likely access paths are `idx_tasks_org_status` for filtering and `idx_tasks_org_updated` for ordering; PostgreSQL may choose a bitmap/heap scan based on selectivity and table statistics. No production-volume benchmark is claimed: run the query on realistic cardinalities, compare buffers/latency, and reconsider composite ordering or keyset pagination based on measured plans.

## Permissions

The migration connection creates/updates a separate runtime role and grants DML/SELECT rights. It does not grant table ownership or `TRUNCATE`; the audit trigger blocks runtime mutation of audit entries. Production should use separate migration credentials and narrowly managed role grants.

# Disaster recovery and backups

## Backup

`scripts/backup.sh` runs `pg_dump -Fc` inside the PostgreSQL service and writes a timestamped custom-format archive under `backups/` (override with `BACKUP_DIR`). It writes to a temporary file first and only publishes the archive after `pg_dump` succeeds. Treat dumps as sensitive data, encrypt them at rest and in transit, and copy them off-host; no cloud backup target is configured here.

```sh
bash scripts/backup.sh
```

## Restore

Restore replaces objects/data in the configured application database and requires explicit confirmation:

```sh
CONFIRM_RESTORE=YES BACKUP_FILE=backups/appdb-YYYYMMDD-HHMMSS.dump bash scripts/restore.sh
```

Run only after stopping API and worker writes and confirming the target environment/database. Restore uses `pg_restore --clean --if-exists --no-owner --exit-on-error` and then verifies the organizations table is readable. Roles/secrets are cluster configuration, not part of the custom database dump; ensure the runtime role exists before restarting the API.

## Recovery assumptions

- **PostgreSQL:** API readiness fails while unavailable. Restore the most recent verified backup or use managed PITR/replica failover. The sample has no automated replication. Suggested production objectives: RPO <= 15 minutes with WAL/PITR, RTO <= 1 hour; these are targets, not measured guarantees.
- **Redis:** Dashboard cache is recomputed after logged cache failures. Rate-limited API traffic returns 503 until Redis is restored; this is intentional fail-closed behavior. Redis persistence supports local restart but is not the source of truth.
- **Worker:** Jobs remain in PostgreSQL. Restarting resumes pending jobs and claims processing rows whose lock is older than five minutes. Transient failures retry five times with exponential delay; exhausted jobs move to `dead` and require operator inspection/replay tooling (not yet implemented).
- **Application:** Compose uses restart policies and readiness/healthchecks. `/health` indicates process liveness; `/ready` checks PostgreSQL, Redis, and Keycloak JWKS availability.

## Restore drill

For a repeatable test, use an isolated Compose project/database. Create sample data, run backup, delete/recreate only that disposable database, restore, and verify organization/task counts and foreign keys. This repository provides the scripts; a scheduled off-host backup and automated drill are still operational work.

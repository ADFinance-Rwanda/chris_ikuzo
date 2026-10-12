#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?Set BACKUP_FILE to a custom-format dump}"
if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore overwrites objects in the configured PostgreSQL database. Set CONFIRM_RESTORE=YES to proceed." >&2
  exit 2
fi
if [[ ! -s "$BACKUP_FILE" ]]; then
  echo "Backup file does not exist or is empty: $BACKUP_FILE" >&2
  exit 2
fi

docker compose stop backend worker
docker compose exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  < "$BACKUP_FILE"

docker compose exec -T postgres sh -c \
  'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --tuples-only --command="SELECT COUNT(*) FROM organizations;"'
docker compose start backend worker
echo "Restore completed and organizations table is readable."

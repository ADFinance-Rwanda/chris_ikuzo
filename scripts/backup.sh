#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-backups}
timestamp=$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
output="${BACKUP_DIR%/}/appdb-${timestamp}.dump"
temporary="${output}.tmp"
trap 'rm -f "$temporary"' EXIT

docker compose exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  > "$temporary"

test -s "$temporary"
mv "$temporary" "$output"
trap - EXIT
echo "Backup created: $output"

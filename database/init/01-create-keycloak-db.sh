#!/bin/sh
set -eu

createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" "$KEYCLOAK_DB"

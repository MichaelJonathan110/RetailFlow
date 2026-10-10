#!/usr/bin/env bash
# RetailFlow: create schemas, tables, views and reference seed data.
# Idempotent - safe to re-run. Works three ways, in order of preference:
#   1) a local `psql` plus $DATABASE_URL        -> CI, Neon, any remote host
#   2) a local `psql` plus PG* variables        -> local PostgreSQL
#   3) the docker-compose postgres container    -> default local development
set -euo pipefail

# Resolve the repo root from this script's location (no hard-coded paths).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_PORT|DATABASE_URL)=' .env | xargs) || true
fi

FILES="database/ddl/00_schemas.sql \
database/ddl/01_app.sql \
database/ddl/02_ops.sql \
database/ddl/03_staging.sql \
database/ddl/04_warehouse.sql \
database/views/10_analytics_views.sql \
database/warehouse/20_seed_reference.sql"

if command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  # SQLAlchemy-style URLs carry a driver suffix psql does not understand.
  URL="${DATABASE_URL/postgresql+psycopg:/postgresql:}"
  echo "applying schema with psql -> ${URL%%\?*}"
  psql "$URL" -v ON_ERROR_STOP=1 -q -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
  for f in $FILES; do
    echo "  $f"
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
else
  CONT="${POSTGRES_CONTAINER:-retailflow-postgres}"
  DB="${POSTGRES_DB:-retailflow}"
  USER="${POSTGRES_USER:-retailflow}"
  if docker ps --format '{{.Names}}' | grep -qx "$CONT"; then
    echo "postgres container already running"
  else
    echo "starting postgres via docker compose..."
    docker compose up -d postgres
  fi
  echo "waiting for postgres to accept connections..."
  for i in $(seq 1 60); do
    if docker exec "$CONT" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
      echo "postgres ready after ${i}s"
      break
    fi
    sleep 1
  done
  docker exec -i "$CONT" psql -v ON_ERROR_STOP=1 -q -U "$USER" -d "$DB" \
    -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
  for f in $FILES; do
    echo "applying $f"
    docker exec -i "$CONT" psql -v ON_ERROR_STOP=1 -q -U "$USER" -d "$DB" < "$f"
  done
fi

echo "DB_INIT_OK"

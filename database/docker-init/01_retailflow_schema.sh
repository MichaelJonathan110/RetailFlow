#!/bin/sh
# Runs ONCE, when the postgres volume is empty (docker-entrypoint-initdb.d).
# Applies the same files, in the same order, as scripts/init_db.sh.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -q -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
for f in ddl/00_schemas.sql ddl/01_app.sql ddl/02_ops.sql ddl/03_staging.sql ddl/04_warehouse.sql views/10_analytics_views.sql warehouse/20_seed_reference.sql; do
  echo "retailflow init: $f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -q -f "/retailflow-db/$f"
done

#!/usr/bin/env bash
# RetailFlow — bring the whole platform up and prove it works.
# Idempotent: safe to re-run. Stops at the first real failure.
set -euo pipefail

ROOT="C:/Users/kohja/retailflow"
cd "$ROOT"

step() { printf '
=== %s ===
' "$1"; }

step "1/8 Environment"
python --version
node --version
docker --version

step "2/8 PostgreSQL container"
docker compose up -d postgres
for i in $(seq 1 60); do
  if docker exec retailflow-postgres pg_isready -U retailflow -d retailflow >/dev/null 2>&1; then
    echo "postgres ready after ${i}s"; break
  fi
  [ "$i" -eq 60 ] && { echo "postgres never became ready"; exit 1; }
  sleep 1
done

step "3/8 Database schema + reference data"
bash scripts/init_db.sh

step "4/8 Python dependencies"
cd backend
if [ ! -d .venv ]; then python -m venv .venv; fi
# shellcheck disable=SC1091
source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt

step "5/8 Demo fixture"
python ../scripts/seed_demo.py --out ../sample-data --orders 1500

step "6/8 Start the API"
mkdir -p ../.pids
( uvicorn app.main:app --host 127.0.0.1 --port 8020 > ../api.log 2>&1 & echo $! > ../.pids/api.pid )
for i in $(seq 1 45); do
  if curl -sf http://127.0.0.1:8020/api/v1/health >/dev/null 2>&1; then
    echo "api ready after ${i}s"; break
  fi
  [ "$i" -eq 45 ] && { echo "api never became ready"; tail -30 ../api.log; exit 1; }
  sleep 1
done

step "7/8 Ingest the fixture and run the master pipeline"
python ../scripts/seed_demo.py --out ../sample-data --orders 1500 --upload http://127.0.0.1:8020/api/v1
MASTER_ID=$(curl -s http://127.0.0.1:8020/api/v1/pipelines \
  | python -c "import sys,json; d=json.load(sys.stdin); print([p['pipeline_id'] for p in d['items'] if p['name']=='RetailFlow Master Pipeline'][0])")
echo "master pipeline id = $MASTER_ID"
curl -s -X POST "http://127.0.0.1:8020/api/v1/pipelines/$MASTER_ID/run" \
  -H 'Content-Type: application/json' -d '{"triggered_by":"run_all.sh"}' \
  | python -m json.tool | head -30

step "8/8 Frontend"
cd ../frontend
if [ ! -d node_modules ]; then npm install; fi
npm run build
( npm run start > ../web.log 2>&1 & echo $! > ../.pids/web.pid )
for i in $(seq 1 45); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || true)
  if [ "$CODE" = "200" ]; then echo "web ready after ${i}s (HTTP 200)"; break; fi
  [ "$i" -eq 45 ] && { echo "web never returned 200"; tail -30 ../web.log; exit 1; }
  sleep 1
done

step "Verification"
curl -s http://127.0.0.1:8020/api/v1/health | python -m json.tool
curl -s -o /dev/null -w 'GET /api/v1/overview -> %{http_code}
' http://127.0.0.1:8020/api/v1/overview
curl -s -o /dev/null -w 'GET /              -> %{http_code}
' http://127.0.0.1:3000

echo
 echo "RetailFlow is up:"
echo "  API  http://localhost:8020/api/v1/docs"
echo "  UI   http://localhost:3000"

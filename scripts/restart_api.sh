#!/usr/bin/env bash
set -uo pipefail
ROOT="C:/Users/kohja/retailflow"
cd "$ROOT"
mkdir -p logs .pids
if [ -f .pids/api.pid ]; then kill "$(cat .pids/api.pid)" 2>/dev/null || true; rm -f .pids/api.pid; fi
for p in $(netstat -ano | grep LISTENING | grep ':8020' | awk '{print $NF}' | sort -u); do taskkill //F //PID "$p" 2>/dev/null || true; done
sleep 2
PY="$ROOT/backend/.venv/Scripts/python.exe"; [ -x "$PY" ] || PY=python
( cd "$ROOT/backend" && nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8020 > "$ROOT/logs/api.log" 2>&1 & echo $! > "$ROOT/.pids/api.pid" )
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8020/api/v1/health || true)
  [ "$c" = "200" ] && { echo "api ready after ${i}s"; break; }
  sleep 1
done
echo "pid=$(cat .pids/api.pid)"
grep -a -iE 'bind|startup complete|ERROR' logs/api.log | head -5

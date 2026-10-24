#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Stop both services when Run is stopped, or when either process exits.
pids=()
cleanup() {
  trap - EXIT INT TERM
  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd src/backend && exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
pids+=("$!")
./node_modules/.bin/vite --host 0.0.0.0 --port 5000 &
pids+=("$!")
wait -n "${pids[@]}"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../src/backend"
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-5000}"

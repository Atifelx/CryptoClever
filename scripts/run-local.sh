#!/usr/bin/env sh
# Run backend (with in-memory store, no Redis) and Next.js for local testing.
# Usage: from repo root: ./scripts/run-local.sh
# Or run the two commands below in separate terminals.

set -e
cd "$(dirname "$0")/.."

echo "Starting backend (USE_MEMORY_STORE=1, no Redis required) on port 8000..."
USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Waiting for backend to be ready..."
sleep 5
curl -sf http://127.0.0.1:8000/health > /dev/null || { echo "Backend failed to start"; kill $BACKEND_PID 2>/dev/null; exit 1; }

echo "Backend is up. Start Next.js in another terminal:"
echo "  cd $(pwd) && BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000 npm run dev"
echo ""
echo "Then open http://localhost:3000 (or the port shown)."
echo "Backend PID: $BACKEND_PID (kill with: kill $BACKEND_PID)"
wait $BACKEND_PID

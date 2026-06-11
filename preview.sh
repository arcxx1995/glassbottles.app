#!/bin/bash
# Starts the dev server and opens the preview page.
# Usage: ./preview.sh

cd "$(dirname "$0")"

# Start dev server in background if not already running
if ! lsof -ti:3000 > /dev/null 2>&1; then
  echo "Starting dev server..."
  pnpm dev &
  DEV_PID=$!
  # Wait for Next.js to be ready
  echo "Waiting for server..."
  until curl -s http://localhost:3000 > /dev/null 2>&1; do
    sleep 1
  done
  echo "Server ready."
else
  echo "Dev server already running on :3000"
fi

open http://localhost:3000/preview

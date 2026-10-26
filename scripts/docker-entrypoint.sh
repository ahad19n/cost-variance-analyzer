#!/bin/sh
set -e
if [ "$SEED_DEMO" = "true" ]; then
  node scripts/seed.js
fi
exec node src/server.js

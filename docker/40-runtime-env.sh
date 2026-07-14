#!/bin/sh
# Writes the runtime config consumed by src/integrations/supabase/client.ts.
# Runs automatically via the nginx image's /docker-entrypoint.d/ mechanism.
set -eu

: "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL must be set (e.g. via docker-compose environment)}"
: "${VITE_SUPABASE_PUBLISHABLE_KEY:?VITE_SUPABASE_PUBLISHABLE_KEY must be set}"

cat > /usr/share/nginx/html/env.js <<EOF
window.__ENV = {
  VITE_SUPABASE_URL: "${VITE_SUPABASE_URL}",
  VITE_SUPABASE_PUBLISHABLE_KEY: "${VITE_SUPABASE_PUBLISHABLE_KEY}",
};
EOF

echo "40-runtime-env.sh: env.js written (VITE_SUPABASE_URL=${VITE_SUPABASE_URL})"

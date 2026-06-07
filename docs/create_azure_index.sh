#!/usr/bin/env bash
# Creates (or updates) the single Azure AI Search index used by Meeting_KMS.
#
# Usage:
#   export AZURE_SEARCH_ENDPOINT="https://<your-service>.search.windows.net"
#   export AZURE_SEARCH_API_KEY="<admin-key>"        # must be an ADMIN key, not a query key
#   export AZURE_SEARCH_INDEX_NAME="meeting-kms-index" # optional, defaults to value in the JSON
#   ./create_azure_index.sh
#
# Notes:
# - Only ONE index is needed. Segments and summaries live in the same index,
#   distinguished by the `docType` field ("segment" vs "metadata").
# - The vector field `embedding` is 3072 dims to match OpenAI text-embedding-3-large.
#   If you switch to text-embedding-3-small, change "dimensions" to 1536 in the JSON.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$HERE/azure_search_index.json"
API_VERSION="2023-11-01"

: "${AZURE_SEARCH_ENDPOINT:?set AZURE_SEARCH_ENDPOINT}"
: "${AZURE_SEARCH_API_KEY:?set AZURE_SEARCH_API_KEY (admin key)}"

# Allow overriding the index name without editing the JSON.
if [[ -n "${AZURE_SEARCH_INDEX_NAME:-}" ]]; then
  BODY="$(python3 -c "import json,sys,os; d=json.load(open('$SCHEMA')); d['name']=os.environ['AZURE_SEARCH_INDEX_NAME']; print(json.dumps(d))")"
else
  BODY="$(cat "$SCHEMA")"
fi

NAME="$(printf '%s' "$BODY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
ENDPOINT="${AZURE_SEARCH_ENDPOINT%/}"

echo "Creating/updating index '$NAME' on $ENDPOINT ..."
curl -sS -X PUT \
  "$ENDPOINT/indexes/$NAME?api-version=$API_VERSION" \
  -H "Content-Type: application/json" \
  -H "api-key: $AZURE_SEARCH_API_KEY" \
  -d "$BODY" \
  -w '\nHTTP %{http_code}\n'

echo "Done. Set AZURE_SEARCH_INDEX_NAME=$NAME as a Supabase secret."

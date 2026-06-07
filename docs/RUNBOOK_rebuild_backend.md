# Rebuild Backend Runbook

The original Supabase project (`xjljwhqmnbbeiyutgswc`) was a Lovable-managed project
and no longer exists (DNS returns NXDOMAIN). All edge functions and all Azure secrets
lived there and cannot be recovered. This runbook stands up a fresh backend.

## What changed in the code

The AI provider was migrated **Azure AI Foundry → OpenAI** (Azure keys are gone).
Azure AI Search is **kept** (you create a new service + index).

| Concern | Before | Now |
|---|---|---|
| Embeddings | Azure `text-embedding-3-large` | OpenAI `text-embedding-3-large` (3072 dims) |
| Chat / summaries / agent router | Azure `gpt-5.2-chat` (Responses API) | OpenAI `gpt-4o` (Responses API) |
| Lightweight tasks | Azure `gpt-5-nano` | OpenAI `gpt-4o-mini` |
| Vector store / search | Azure AI Search | Azure AI Search (new service) |
| Function host | Supabase (deleted) | New Supabase project |

All OpenAI calls now go through `supabase/functions/_shared/openai.ts`.
Model names are overridable via secrets (`OPENAI_CHAT_MODEL`, `OPENAI_NANO_MODEL`,
`OPENAI_EMBED_MODEL`) — handy if your OpenAI account lacks `gpt-4o`.

> Note: the repo root is the working copy. The nested `Meeting_KMS_Original/` folder is
> a stale duplicate — ignore it (or delete it) so you don't edit the wrong files.

## Accounts you need

1. **Supabase** account (free tier OK) — GitHub login.
2. **OpenAI** API key (`sk-...`) with access to `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-large`.
3. **Azure** subscription with an **Azure AI Search** service (free tier OK).
   As a KIT student you can use Azure for Students ($100, no card).

---

## Step 1 — New Supabase project

1. https://supabase.com/dashboard → New project. Pick a region near you.
2. Project Settings → API. Copy:
   - **Project URL**            → `VITE_SUPABASE_URL`
   - **anon public key**        → `VITE_SUPABASE_PUBLISHABLE_KEY`
   - **Reference ID** (the `xxxx` in the URL) → `VITE_SUPABASE_PROJECT_ID`
3. Update `.env` in the repo root:
   ```
   VITE_SUPABASE_PROJECT_ID="<ref-id>"
   VITE_SUPABASE_PUBLISHABLE_KEY="<anon-key>"
   VITE_SUPABASE_URL="https://<ref-id>.supabase.co"
   ```
4. Update `supabase/config.toml` → `project_id = "<ref-id>"`.

## Step 2 — Azure AI Search service + index

1. Azure Portal → create an **Azure AI Search** service (Free tier is fine for testing).
2. Keys → copy an **admin key**. Note the service URL `https://<name>.search.windows.net`.
3. Create the single index (segments + summaries share it, see `docs/azure_search_index.json`):
   ```bash
   export AZURE_SEARCH_ENDPOINT="https://<name>.search.windows.net"
   export AZURE_SEARCH_API_KEY="<admin-key>"
   export AZURE_SEARCH_INDEX_NAME="meeting-kms-index"
   bash docs/create_azure_index.sh
   ```

## Step 3 — OpenAI key

Get an API key at https://platform.openai.com/api-keys. Verify the three models are
available to your account: `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-large`.

## Step 4 — Set Supabase secrets (function env)

Install the CLI and link the project:
```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ref-id>
```

Set the secrets the functions read:
```bash
supabase secrets set \
  OPENAI_API_KEY="sk-..." \
  AZURE_SEARCH_ENDPOINT="https://<name>.search.windows.net" \
  AZURE_SEARCH_API_KEY="<admin-key>" \
  AZURE_SEARCH_INDEX_NAME="meeting-kms-index"
```
Optional model overrides (only if your account can't use the defaults):
```bash
supabase secrets set OPENAI_CHAT_MODEL="gpt-4o" OPENAI_NANO_MODEL="gpt-4o-mini" OPENAI_EMBED_MODEL="text-embedding-3-large"
```

## Step 5 — Deploy the edge functions

```bash
supabase functions deploy --no-verify-jwt
```
(or deploy individually: `supabase functions deploy transcripts-chat`, etc.)

## Step 6 — Verify the stack

```bash
ANON="<anon-key>"
curl -s -X POST "https://<ref-id>.supabase.co/functions/v1/azure-endpoints-diagnose" \
  -H "Authorization: Bearer $ANON" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}'
```
Expect `success: true` with three probes ok: `openai_embeddings` (shows dims=3072),
`openai_responses`, `azure_search` (shows docCount).

## Step 7 — Run the frontend

```bash
npm install
npm run dev
```
Upload a transcript → it should embed (OpenAI), index (Azure Search), and summarize/chat.

---

## Secrets reference (Supabase → Edge Functions)

| Secret | Required | Default | Used by |
|---|---|---|---|
| `OPENAI_API_KEY` | yes | — | all AI functions |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | all AI functions |
| `OPENAI_CHAT_MODEL` | no | `gpt-4o` | chat, summaries, check |
| `OPENAI_NANO_MODEL` | no | `gpt-4o-mini` | save-summary, intent analysis |
| `OPENAI_EMBED_MODEL` | no | `text-embedding-3-large` | embeddings (must match index dims) |
| `AZURE_SEARCH_ENDPOINT` | yes | — | all search/index functions |
| `AZURE_SEARCH_API_KEY` | yes | — | all search/index functions |
| `AZURE_SEARCH_INDEX_NAME` | yes | — | all search/index functions |

If you change `OPENAI_EMBED_MODEL` to `text-embedding-3-small`, also change the
`embedding` field `dimensions` to `1536` in `docs/azure_search_index.json` and recreate
the index — the vector dimension must match the model output.

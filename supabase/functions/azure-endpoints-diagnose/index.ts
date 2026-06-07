import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CHAT_MODEL, EMBED_MODEL, openaiConfigured, responsesFetch } from "../_shared/openai.ts";

// Diagnostic endpoint: verifies the rebuilt backend can reach
//   1) OpenAI embeddings   (text-embedding-3-large by default)
//   2) OpenAI responses     (gpt-4o by default)
//   3) Azure AI Search      (the configured index)
//
// Call it after wiring up secrets to confirm everything is reachable:
//   curl -X POST "$SUPABASE_URL/functions/v1/azure-endpoints-diagnose" \
//     -H "Authorization: Bearer $ANON_KEY" -H "apikey: $ANON_KEY"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_BASE_URL = (Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");

type ProbeResult = {
  name: string;
  ok: boolean;
  status: number;
  detail?: string;
};

function summarizeError(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    return parsed?.error?.message ?? parsed?.error?.code ?? bodyText.slice(0, 300);
  } catch {
    return bodyText.slice(0, 300);
  }
}

async function probeOpenAIEmbeddings(): Promise<ProbeResult> {
  if (!openaiConfigured()) {
    return { name: "openai_embeddings", ok: false, status: 0, detail: "OPENAI_API_KEY not set" };
  }
  const resp = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: ["ping"] }),
  });
  if (resp.ok) {
    const data = await resp.json();
    const dims = data?.data?.[0]?.embedding?.length ?? 0;
    return { name: "openai_embeddings", ok: true, status: resp.status, detail: `model=${EMBED_MODEL}, dims=${dims}` };
  }
  return { name: "openai_embeddings", ok: false, status: resp.status, detail: summarizeError(await resp.text()) };
}

async function probeOpenAIResponses(): Promise<ProbeResult> {
  if (!openaiConfigured()) {
    return { name: "openai_responses", ok: false, status: 0, detail: "OPENAI_API_KEY not set" };
  }
  const resp = await responsesFetch({
    model: CHAT_MODEL,
    input: [{ role: "user", content: "ping" }],
    max_output_tokens: 16,
  });
  if (resp.ok) {
    await resp.text();
    return { name: "openai_responses", ok: true, status: resp.status, detail: `model=${CHAT_MODEL}` };
  }
  return { name: "openai_responses", ok: false, status: resp.status, detail: summarizeError(await resp.text()) };
}

async function probeAzureSearch(): Promise<ProbeResult> {
  const endpoint = (Deno.env.get("AZURE_SEARCH_ENDPOINT") ?? "").replace(/\/+$/, "");
  const apiKey = Deno.env.get("AZURE_SEARCH_API_KEY") ?? "";
  const indexName = Deno.env.get("AZURE_SEARCH_INDEX_NAME") ?? "";
  if (!endpoint || !apiKey || !indexName) {
    return { name: "azure_search", ok: false, status: 0, detail: "AZURE_SEARCH_ENDPOINT/API_KEY/INDEX_NAME not all set" };
  }
  const url = `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ search: "*", top: 0, count: true }),
  });
  if (resp.ok) {
    const data = await resp.json();
    const count = data?.["@odata.count"] ?? "unknown";
    return { name: "azure_search", ok: true, status: resp.status, detail: `index=${indexName}, docCount=${count}` };
  }
  return { name: "azure_search", ok: false, status: resp.status, detail: summarizeError(await resp.text()) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const results = await Promise.all([
      probeOpenAIEmbeddings(),
      probeOpenAIResponses(),
      probeAzureSearch(),
    ]);

    const allOk = results.every((r) => r.ok);
    return new Response(JSON.stringify({ success: allOk, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("endpoints-diagnose error:", error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

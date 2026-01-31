import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProbeResult = {
  name: "gpt52" | "embeddings3l";
  kind: "responses" | "embeddings";
  host: string | null;
  pathname: string | null;
  deployment: string | null;
  apiVersion: string | null;
  looksLike: "ok" | "wrong_endpoint" | "unknown";
  ok: boolean;
  status: number;
  errorCode?: string;
  errorMessage?: string;
};

function parseEndpoint(endpoint: string): {
  host: string;
  deployment: string | null;
  apiVersion: string | null;
  pathname: string;
} {
  const url = new URL(endpoint);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => p === "deployments");
  const deployment = i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : null;
  const apiVersion = url.searchParams.get("api-version");
  return { host: url.host, deployment, apiVersion, pathname: url.pathname };
}

function parseAzureError(bodyText: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(bodyText);
    const code = parsed?.error?.code;
    const message = parsed?.error?.message;
    if (typeof code === "string" || typeof message === "string") {
      return {
        code: typeof code === "string" ? code : undefined,
        message: typeof message === "string" ? message : undefined,
      };
    }
  } catch {
    // ignore
  }
  return { message: bodyText?.slice(0, 500) };
}

async function probeEmbeddings(endpoint: string, apiKey: string): Promise<ProbeResult> {
  const meta = parseEndpoint(endpoint);
  const looksLike = meta.pathname.includes("/embeddings") ? "ok" : "wrong_endpoint";

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({ input: ["ping"] }),
  });

  if (resp.ok) {
    // Important in Deno: always consume body
    await resp.text();
    return {
      name: "embeddings3l",
      kind: "embeddings",
      host: meta.host,
      pathname: meta.pathname,
      deployment: meta.deployment,
      apiVersion: meta.apiVersion,
      looksLike,
      ok: true,
      status: resp.status,
    };
  }

  const text = await resp.text();
  const { code, message } = parseAzureError(text);
  return {
    name: "embeddings3l",
    kind: "embeddings",
    host: meta.host,
    pathname: meta.pathname,
    deployment: meta.deployment,
    apiVersion: meta.apiVersion,
    looksLike,
    ok: false,
    status: resp.status,
    errorCode: code,
    errorMessage: message,
  };
}

async function probeResponses(endpoint: string, apiKey: string): Promise<ProbeResult> {
  const meta = parseEndpoint(endpoint);
  const looksLike = meta.pathname.includes("/responses") ? "ok" : "wrong_endpoint";

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.2-chat",
      input: [{ role: "user", content: "ping" }],
      max_output_tokens: 50,
    }),
  });

  if (resp.ok) {
    await resp.text();
    return {
      name: "gpt52",
      kind: "responses",
      host: meta.host,
      pathname: meta.pathname,
      deployment: meta.deployment,
      apiVersion: meta.apiVersion,
      looksLike,
      ok: true,
      status: resp.status,
    };
  }

  const text = await resp.text();
  const { code, message } = parseAzureError(text);
  return {
    name: "gpt52",
    kind: "responses",
    host: meta.host,
    pathname: meta.pathname,
    deployment: meta.deployment,
    apiVersion: meta.apiVersion,
    looksLike,
    ok: false,
    status: resp.status,
    errorCode: code,
    errorMessage: message,
  };
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
    const gptEndpoint = Deno.env.get("AZURE_FOUNDRY_GPT52CHAT_ENDPOINT") ?? "";
    const gptKey = Deno.env.get("AZURE_FOUNDRY_GPT52CHAT_API_KEY") ?? "";
    const embEndpoint = Deno.env.get("AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_ENDPOINT") ?? "";
    const embKey = Deno.env.get("AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_API_KEY") ?? "";

    const results: ProbeResult[] = [];

    results.push(
      gptEndpoint && gptKey
        ? await probeResponses(gptEndpoint, gptKey)
        : {
          name: "gpt52",
          kind: "responses",
          host: gptEndpoint ? parseEndpoint(gptEndpoint).host : null,
          pathname: gptEndpoint ? parseEndpoint(gptEndpoint).pathname : null,
          deployment: gptEndpoint ? parseEndpoint(gptEndpoint).deployment : null,
          apiVersion: gptEndpoint ? parseEndpoint(gptEndpoint).apiVersion : null,
          looksLike: "unknown",
          ok: false,
          status: 0,
          errorCode: "MissingConfig",
          errorMessage: "Missing AZURE_FOUNDRY_GPT52CHAT_ENDPOINT/API_KEY",
        },
    );

    results.push(
      embEndpoint && embKey
        ? await probeEmbeddings(embEndpoint, embKey)
        : {
          name: "embeddings3l",
          kind: "embeddings",
          host: embEndpoint ? parseEndpoint(embEndpoint).host : null,
          pathname: embEndpoint ? parseEndpoint(embEndpoint).pathname : null,
          deployment: embEndpoint ? parseEndpoint(embEndpoint).deployment : null,
          apiVersion: embEndpoint ? parseEndpoint(embEndpoint).apiVersion : null,
          looksLike: "unknown",
          ok: false,
          status: 0,
          errorCode: "MissingConfig",
          errorMessage: "Missing AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_ENDPOINT/API_KEY",
        },
    );

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("azure-endpoints-diagnose error:", error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

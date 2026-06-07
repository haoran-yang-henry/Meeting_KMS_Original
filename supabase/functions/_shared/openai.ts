// Shared OpenAI client for all edge functions.
//
// Replaces the previous Azure AI Foundry integration. Configure these Supabase
// secrets:
//   OPENAI_API_KEY      - required, your OpenAI API key (sk-...)
//   OPENAI_BASE_URL     - optional, defaults to https://api.openai.com/v1
//   OPENAI_CHAT_MODEL   - optional, defaults to gpt-5.2-chat-latest
//   OPENAI_NANO_MODEL   - optional, defaults to gpt-5-nano
//   OPENAI_EMBED_MODEL  - optional, defaults to text-embedding-3-large (3072 dims)
//
// NOTE: OPENAI_EMBED_MODEL must match the `dimensions` of the `embedding` field
// in the Azure Search index. text-embedding-3-large -> 3072, -3-small -> 1536.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_BASE_URL = (Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");

export const CHAT_MODEL = Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-5.2-chat-latest";
export const NANO_MODEL = Deno.env.get("OPENAI_NANO_MODEL") ?? "gpt-5-nano";
export const EMBED_MODEL = Deno.env.get("OPENAI_EMBED_MODEL") ?? "text-embedding-3-large";

export function openaiConfigured(): boolean {
  return OPENAI_API_KEY.length > 0;
}

/**
 * Generate embeddings for a batch of texts via OpenAI.
 * Response shape matches the previous Azure call: result.data[].embedding.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI embeddings error:", errorText);
    throw new Error(`OpenAI embeddings error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  if (!result?.data || !Array.isArray(result.data)) {
    throw new Error("OpenAI embeddings returned unexpected structure");
  }
  return result.data.map((item: { embedding: number[] }) => item.embedding);
}

/** Convenience wrapper for a single embedding. */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

/**
 * Call the OpenAI Responses API (https://platform.openai.com/docs/api-reference/responses).
 * The body mirrors what the functions already build (model/input/tools/tool_choice/
 * max_output_tokens), so existing response parsing (result.output / result.output_text)
 * keeps working. Returns the raw Response so callers keep their own error handling.
 */
export function responsesFetch(body: Record<string, unknown>): Promise<Response> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Call the OpenAI Chat Completions API. Body should contain at least
 * { model, messages }. Returns the raw Response; callers parse
 * result.choices[0].message.content as before.
 */
export function chatCompletionsFetch(body: Record<string, unknown>): Promise<Response> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

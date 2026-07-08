// Single provider integration point: everything talks to the OpenAI API.
// Models are overridable via env so a model rename never requires a redeploy.

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

// gpt-5.2-chat-latest is the chat-tuned (non-reasoning) variant — the right fit
// for routing/summaries here; plain gpt-5.2 would burn output budget on reasoning.
export const CHAT_MODEL = Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-5.2-chat-latest";
export const MINI_MODEL = Deno.env.get("OPENAI_MINI_MODEL") ?? "gpt-5-nano";
const EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-large";

// text-embedding-3-large natively supports Matryoshka dimension reduction.
// 1024 keeps vectors under pgvector's 2000-dim HNSW limit and cuts storage 3x.
// Must match vector(1024) in the segments table — re-embed everything if changed.
export const EMBEDDING_DIMENSIONS = 1024;

export function getOpenAIKey(): string | undefined {
  return Deno.env.get("OPENAI_API_KEY");
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI embedding error:", response.status, errorText);
    throw new Error(`OpenAI embedding error: ${response.status}`);
  }

  const result = await response.json();
  return result.data.map((item: { embedding: number[] }) => item.embedding);
}

/** Embed texts in batches to stay under API request limits. */
export async function getEmbeddingsBatched(
  texts: string[],
  batchSize = 16,
): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    all.push(...await getEmbeddings(batch));
  }
  return all;
}

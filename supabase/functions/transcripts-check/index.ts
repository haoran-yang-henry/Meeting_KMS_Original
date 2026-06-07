import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CHAT_MODEL, openaiConfigured, responsesFetch } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ 类型定义 ============

interface TranscriptSegment {
  segmentId: string;
  transcriptId?: string;
  text: string;
  startTime?: string;
  endTime?: string;
  speaker?: string;
}

interface CorrectionSuggestion {
  suggestionId: string;
  transcriptId: string;
  segmentId: string;
  originalText: string;
  suggestedText: string;
  reasoning: string;
  confidence: number;
  issueType: "incorrect_domain_term" | "vague_wording" | "misspelling" | "abbreviation" | "omit" | "other";
  priority: "context" | "general";
  action?: "replace" | "remove" | "redact";
}

interface Glossary {
  [incorrectTerm: string]: string;
}

interface CheckRequest {
  transcriptId: string;
  segments: TranscriptSegment[];
  additionalContext?: string;
  glossary?: Glossary | string;
  projectContext?: string;
  projectMemory?: string;
  omitRules?: string[];
}

// ============ 核心函数 ============

interface ModelConfig {
  name: string;
  provider: "azure_chat" | "azure_responses" | "lovable_chat";
  endpoint: string;
  apiKey: string;
  useReasoningEffort: boolean; // gpt-5 系列可用 reasoning_effort 来限制推理 token 消耗
}

const systemPrompt = `You are an enterprise-grade transcription correction agent.

Your task is to REVIEW meeting transcript segments and RETURN STRUCTURED CORRECTION SUGGESTIONS.

You MUST NOT rewrite the full transcript.
You MUST NOT invent information.
You MUST NOT change the meaning of any sentence.
Your job is ONLY to detect issues and propose minimal corrections.

Return ONLY valid JSON.`;

function extractTextFromResponsesAPI(result: any): string {
  // OpenAI Responses API convenience field
  if (typeof result?.output_text === "string") return result.output_text;

  // Common Responses API shape: { output: [{ type: 'message', content: [{ type:'output_text', text:'...' }] }] }
  const output = result?.output;
  if (Array.isArray(output)) {
    const message = output.find((o: any) => o?.type === "message") || output[0];
    const contentArr = message?.content;
    if (Array.isArray(contentArr)) {
      const texts = contentArr.map((c: any) => c?.text).filter((t: any) => typeof t === "string");
      if (texts.length) return texts.join("");
    }
  }

  return "";
}

async function callModel(prompt: string, config: ModelConfig): Promise<string> {
  console.log(`Calling model: ${config.name} (${config.provider})`);

  // 1) Lovable AI gateway (reliable fallback)
  if (config.provider === "lovable_chat") {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash", // default reliable model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        // keep enough room for up to ~30 suggestions JSON
        max_tokens: 2500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${config.name} error:`, response.status, errorText);
      throw new Error(`${config.name} error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content || "";
    console.log(`${config.name} content length: ${content.length}`);

    if (!content) {
      console.error(`${config.name} returned empty output:`, JSON.stringify(result));
      throw new Error(`${config.name} returned empty output`);
    }

    return content;
  }

  // 2) Azure OpenAI Chat Completions
  if (config.provider === "azure_chat") {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      // keep this lower to avoid spending the whole budget on internal reasoning
      max_completion_tokens: 1200,
    };

    if (config.useReasoningEffort) {
      body.reasoning_effort = "minimal";
    }

    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${config.name} error:`, response.status, errorText);
      throw new Error(`${config.name} error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const finishReason = result?.choices?.[0]?.finish_reason;
    const content = result?.choices?.[0]?.message?.content || "";
    console.log(`${config.name} finish_reason: ${finishReason}, content length: ${content.length}`);

    if (!content) {
      console.error(`${config.name} returned empty output:`, JSON.stringify(result));
      // This frequently happens when the model spends the entire budget on reasoning_tokens.
      throw new Error(`${config.name} returned empty output (reasoning token exhaustion)`);
    }

    return content;
  }

  // 3) OpenAI Responses API
  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 2000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${config.name} error:`, response.status, errorText);
    throw new Error(`${config.name} error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  // If someone accidentally points this endpoint at an embeddings API, fail with a clear message.
  if (result?.object === "list" && Array.isArray(result?.data) && result?.data?.[0]?.object === "embedding") {
    console.error(`${config.name} returned an embeddings payload (not a chat response).`);
    throw new Error(
      `${config.name} endpoint looks like an embeddings API (wrong endpoint for chat). Please configure a chat/responses endpoint.`,
    );
  }

  const content = extractTextFromResponsesAPI(result);
  console.log(`${config.name} responses content length: ${content.length}`);

  if (!content) {
    console.error(`${config.name} returned empty output:`, JSON.stringify(result));
    throw new Error(`${config.name} returned empty output`);
  }

  return content;
}

// 使用 OpenAI 模型
async function callWithFallback(prompt: string): Promise<string> {
  if (!openaiConfigured()) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const config: ModelConfig = {
    name: CHAT_MODEL,
    provider: "azure_responses",
    endpoint: "",
    apiKey: "",
    useReasoningEffort: false,
  };

  return await callModel(prompt, config);
}

// 构建 Glossary 部分
function buildGlossarySection(glossary: Glossary): string {
  const entries = Object.entries(glossary);
  if (entries.length === 0) return "";

  return `--- GLOSSARY ---
${entries.map(([wrong, correct]) => `${wrong} → preferred term: "${correct}"`).join("\n")}`;
}

// 构建 Omit Rules 部分
function buildOmitSection(omitRules: string[]): string {
  if (omitRules.length === 0) return "";

  return `--- OMIT / REDACTION RULES ---
The following content should be OMITTED IF FOUND:
${omitRules.map((rule) => `- ${rule}`).join("\n")}

If such content is found:
- DO NOT remove it automatically
- Propose it as a correction suggestion with issueType = "omit"
- priority must be "context"`;
}

function parseGlossaryText(input: string): Glossary {
  const map: Glossary = {};
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // Supported patterns:
    // - Agentic AI → preferred term: "agentic AI"
    // - A → B
    // - A -> B
    const preferredMatch = line.match(/^(.*?)\s*→\s*preferred term:\s*"?(.+?)"?\s*$/i);
    if (preferredMatch) {
      const wrong = preferredMatch[1]
        .replace(/^[-*]\s*/, "")
        .replace(/^"|"$/g, "")
        .trim();
      const correct = preferredMatch[2].replace(/^"|"$/g, "").trim();
      if (wrong && correct) map[wrong] = correct;
      continue;
    }

    const arrowMatch = line.match(/^(.*?)\s*(?:→|->)\s*"?(.+?)"?\s*$/);
    if (arrowMatch) {
      const wrong = arrowMatch[1]
        .replace(/^[-*]\s*/, "")
        .replace(/^"|"$/g, "")
        .trim();
      const correct = arrowMatch[2].replace(/^"|"$/g, "").trim();
      if (wrong && correct) map[wrong] = correct;
    }
  }

  return map;
}

function normalizeGlossary(raw: unknown, additionalContext: string): Glossary {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Glossary = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    return out;
  }

  if (typeof raw === "string" && raw.trim()) {
    return parseGlossaryText(raw);
  }

  // Back-compat: if user pasted glossary-like lines into additionalContext
  if (additionalContext && /→\s*preferred term:|\s->\s|\s→\s/.test(additionalContext)) {
    return parseGlossaryText(additionalContext);
  }

  return {};
}

// 清理 AI 响应中的 Markdown
function cleanAIResponse(response: string): string {
  let cleaned = response.trim();

  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

// Attempt to repair truncated JSON from AI responses
function repairTruncatedJSON(jsonStr: string): string {
  let repaired = jsonStr.trim();

  // If it doesn't start with {, it's not valid JSON we can repair
  if (!repaired.startsWith("{")) {
    return repaired;
  }

  // Count brackets and braces
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") braceCount++;
      else if (char === "}") braceCount--;
      else if (char === "[") bracketCount++;
      else if (char === "]") bracketCount--;
    }
  }

  // If we're still in a string, try to close it
  if (inString) {
    // Find the last incomplete string and truncate at a reasonable point
    const lastQuoteIdx = repaired.lastIndexOf('"');
    if (lastQuoteIdx > 0) {
      // Check if this quote is properly escaped
      let escapeCount = 0;
      for (let i = lastQuoteIdx - 1; i >= 0 && repaired[i] === "\\"; i--) {
        escapeCount++;
      }
      if (escapeCount % 2 === 0) {
        // This quote opened a string, we need to close it
        repaired += '"';
      }
    }
    // Recalculate after potential fix
    inString = false;
    braceCount = 0;
    bracketCount = 0;
    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") braceCount++;
        else if (char === "}") braceCount--;
        else if (char === "[") bracketCount++;
        else if (char === "]") bracketCount--;
      }
    }
  }

  // Close any open brackets
  while (bracketCount > 0) {
    repaired += "]";
    bracketCount--;
  }

  // Close any open braces
  while (braceCount > 0) {
    repaired += "}";
    braceCount--;
  }

  return repaired;
}

// Safely parse JSON with repair attempt
function safeParseJSON(jsonStr: string): { suggestions: any[] } | null {
  // First try direct parse
  try {
    return JSON.parse(jsonStr);
  } catch (_e) {
    // Ignore and try repair
  }

  // Try to repair and parse
  try {
    const repaired = repairTruncatedJSON(jsonStr);
    console.log("Attempting JSON repair...");
    const parsed = JSON.parse(repaired);
    console.log("JSON repair successful");
    return parsed;
  } catch (_e) {
    // Ignore and try extraction
  }

  // Last resort: try to extract valid suggestions array
  try {
    // Find the suggestions array start
    const suggestionsMatch = jsonStr.match(/"suggestions"\s*:\s*\[/);
    if (suggestionsMatch && suggestionsMatch.index !== undefined) {
      const startIdx = suggestionsMatch.index + suggestionsMatch[0].length;

      // Try to extract complete suggestion objects
      const suggestions: any[] = [];
      let depth = 1;
      let objStart = -1;
      let inStr = false;
      let esc = false;

      for (let i = startIdx; i < jsonStr.length && depth > 0; i++) {
        const c = jsonStr[i];

        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') {
          inStr = !inStr;
          continue;
        }

        if (!inStr) {
          if (c === "{") {
            if (depth === 1 && objStart === -1) objStart = i;
            depth++;
          } else if (c === "}") {
            depth--;
            if (depth === 1 && objStart !== -1) {
              // Complete object found
              const objStr = jsonStr.slice(objStart, i + 1);
              try {
                const obj = JSON.parse(objStr);
                if (obj.segmentId && obj.originalText && obj.suggestedText) {
                  suggestions.push(obj);
                }
              } catch (_e) {
                // Skip malformed object
              }
              objStart = -1;
            }
          } else if (c === "]") {
            depth--;
          } else if (c === "[") {
            depth++;
          }
        }
      }

      if (suggestions.length > 0) {
        console.log(`Extracted ${suggestions.length} suggestions via manual parsing`);
        return { suggestions };
      }
    }
  } catch (_e) {
    // All attempts failed
  }

  return null;
}

// 构建完整的用户提示
function buildUserPrompt(
  segments: TranscriptSegment[],
  glossary: Glossary,
  projectContext: string,
  additionalContext: string,
  omitRules: string[],
  projectMemory?: string,
): string {
  // 构建 CONTEXT 部分
  const contextParts: string[] = [];

  const glossarySection = buildGlossarySection(glossary);
  if (glossarySection) {
    contextParts.push(glossarySection);
  }

  if (projectMemory) {
    contextParts.push(`--- PROJECT MEMORY ---
This is the accumulated knowledge from previous meetings in this project.
Use it to understand domain terminology, key people, recurring topics, and established conventions.

${projectMemory}`);
  }

  if (projectContext) {
    contextParts.push(`--- PROJECT CONTEXT ---
${projectContext}`);
  }

  if (additionalContext) {
    contextParts.push(`--- ADDITIONAL CONTEXT ---
${additionalContext}`);
  }

  const omitSection = buildOmitSection(omitRules);
  if (omitSection) {
    contextParts.push(omitSection);
  }

  const contextSection =
    contextParts.length > 0
      ? `========================
CONTEXT (HIGH PRIORITY)
========================
The following context is authoritative and must be used when making corrections.

${contextParts.join("\n\n")}`
      : "(No additional context provided)";

  // 构建 SEGMENTS 部分
  const segmentsText = segments
    .map(
      (seg) => `[Segment ${seg.segmentId}]:
"${seg.text}"`,
    )
    .join("\n\n");

  // 完整提示
  return `${contextSection}

========================
TRANSCRIPT SEGMENTS
========================
${segmentsText}

========================
YOUR TASK
========================
For EACH segment, check for the following issues INDEPENDENTLY:

1. CONTEXT-BASED ISSUES (if context is provided)
   - Incorrect domain terms that can be corrected using the glossary
   - Vague placeholders that can be clarified using project context
   - Content that matches the OMIT rules

2. GENERAL ISSUES (always check based on transcript and meeting conetnt, regardless of context)
   - Misspellings
   - Unclear or ambiguous wording
   - Abbreviations without clarification

CRITICAL: Context-based and general corrections are ADDITIVE, not mutually exclusive.
You MUST still return ALL general corrections even when context is provided.
Do NOT skip general issues just because you found context-based issues.

IMPORTANT RULES:
- Context-based corrections should be returned first, followed by general corrections
- Do NOT propose stylistic rewrites
- Do NOT rewrite entire sentences unless strictly necessary
- originalText MUST be an exact substring of the transcript
- suggestedText MUST be the minimal replacement

========================
OUTPUT FORMAT (STRICT)
========================
Return ONLY valid JSON.
No explanations.
No markdown.
No additional text.

If no issues are found, return:
{"suggestions": []}

Otherwise return:
{
  "suggestions": [
    {
      "segmentId": "sX",
      "originalText": "exact text to be replaced",
      "suggestedText": "corrected text",
      "reasoning": "short explanation",
      "confidence": 0.0-1.0,
      "issueType": "incorrect_domain_term | vague_wording | misspelling | abbreviation | omit | other",
      "priority": "context | general"
    }
  ]
}`;
}

// ============ 主服务 ============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as CheckRequest;

    const transcriptId = body.transcriptId;
    const segments = body.segments;
    const additionalContext = typeof body.additionalContext === "string" ? body.additionalContext : "";
    const projectContext = typeof body.projectContext === "string" ? body.projectContext : "";
    const projectMemory = typeof body.projectMemory === "string" ? body.projectMemory : "";
    const omitRules = Array.isArray(body.omitRules) ? body.omitRules : [];
    const glossary = normalizeGlossary(body.glossary, additionalContext);

    // 验证输入
    if (!segments || segments.length === 0) {
      console.log("No segments provided");
      return new Response(
        JSON.stringify({
          success: false,
          error: "No transcript segments found",
          transcriptId,
          suggestions: [],
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(`Checking transcript ${transcriptId} with ${segments.length} segments`);
    console.log(
      `Context received: additionalContext=${additionalContext ? additionalContext.length : 0} chars, projectContext=${projectContext ? projectContext.length : 0} chars, projectMemory=${projectMemory ? projectMemory.length : 0} chars, glossaryEntries=${Object.keys(glossary).length}, omitRules=${omitRules.length}`,
    );

    const allSuggestions: CorrectionSuggestion[] = [];
    const maxSuggestions = 30;
    const batchSize = 30;

    // 关键：如果 AI 调用失败（例如输出为空），不要返回 success=true + 空 suggestions（会误导前端显示“无需修正”）
    let anyBatchSucceeded = false;
    let lastBatchError: string | null = null;

    // 分批处理
    for (let i = 0; i < segments.length; i += batchSize) {
      if (allSuggestions.length >= maxSuggestions) break;

      const batch = segments.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: segments ${i + 1}-${i + batch.length}`);

      const prompt = buildUserPrompt(batch, glossary, projectContext, additionalContext, omitRules, projectMemory);

      try {
        const aiResponse = await callWithFallback(prompt);
        const cleaned = cleanAIResponse(aiResponse);

        console.log("AI response (cleaned):", cleaned.substring(0, 200));

        const parsed = safeParseJSON(cleaned);
        if (parsed && Array.isArray(parsed.suggestions)) {
          for (const suggestion of parsed.suggestions) {
            if (allSuggestions.length >= maxSuggestions) break;

            allSuggestions.push({
              suggestionId: `sug_${transcriptId}_${allSuggestions.length}`,
              transcriptId,
              segmentId: suggestion.segmentId,
              originalText: suggestion.originalText,
              suggestedText: suggestion.suggestedText,
              reasoning: suggestion.reasoning || "",
              confidence: suggestion.confidence ?? 0.8,
              issueType: suggestion.issueType || "other",
              priority: suggestion.priority || "general",
              action: suggestion.issueType === "omit" ? "remove" : "replace",
            });
          }
        }

        anyBatchSucceeded = true;
      } catch (error) {
        lastBatchError = error instanceof Error ? error.message : String(error);
        console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
      }
    }

    if (!anyBatchSucceeded) {
      return new Response(
        JSON.stringify({
          success: false,
          error: lastBatchError || "AI check failed",
          transcriptId,
          suggestions: [],
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 排序: context 优先, 然后按置信度
    allSuggestions.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === "context" ? -1 : 1;
      }
      return b.confidence - a.confidence;
    });

    const contextCount = allSuggestions.filter((s) => s.priority === "context").length;
    const generalCount = allSuggestions.filter((s) => s.priority === "general").length;

    console.log(
      `Complete: ${allSuggestions.length} total suggestions (context: ${contextCount}, general: ${generalCount})`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        transcriptId,
        suggestions: allSuggestions,
        totalSegmentsChecked: segments.length,
        stats: {
          contextBased: contextCount,
          general: generalCount,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in transcripts-check:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

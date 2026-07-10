import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getOpenAIKey, CHAT_MODEL, OPENAI_RESPONSES_URL } from "./openai.ts";

export interface GeneratedSummary {
  summaryText: string;
  topicTags: string[];
}

export interface SummaryOptions {
  includeDecisions: boolean;
  includeActionItems: boolean;
  includeTopicTags: boolean;
}

/**
 * Fetch transcript segments from Postgres. `supabase` may be an RLS-scoped user
 * client or a service-role client (worker path).
 */
export async function fetchTranscriptSegments(
  supabase: SupabaseClient,
  transcriptId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("segments")
    .select("text, start_time")
    .eq("transcript_id", transcriptId)
    .order("start_time")
    .limit(100);

  if (error) {
    console.error("Fetch segments error:", error);
    throw new Error("Failed to fetch segments");
  }

  return (data ?? []).map((row) => row.text);
}

/**
 * Call GPT-5.2-Chat (Responses API) to generate a summary from segments.
 */
export async function generateSummaryWithAI(
  segments: string[],
  _options: SummaryOptions,
  endpoint: string,
  apiKey: string,
): Promise<GeneratedSummary> {
  const maxSegments = 300;
  let selectedSegments: string[];

  if (segments.length <= maxSegments) {
    selectedSegments = segments;
  } else {
    const beginCount = Math.floor(maxSegments * 0.4);
    const middleCount = Math.floor(maxSegments * 0.3);
    const endCount = maxSegments - beginCount - middleCount;
    const middleStart = Math.floor(segments.length / 2) - Math.floor(middleCount / 2);
    selectedSegments = [
      ...segments.slice(0, beginCount),
      ...segments.slice(middleStart, middleStart + middleCount),
      ...segments.slice(-endCount),
    ];
  }

  const transcriptText = selectedSegments.join("\n\n");
  const maxChars = 100000;
  const finalContent =
    transcriptText.length > maxChars
      ? transcriptText.substring(0, maxChars) + "\n\n[Transcript truncated due to length...]"
      : transcriptText;

  const prompt = `Analyze the following meeting transcript and generate a CONCISE executive summary.

IMPORTANT: Detect the language of the transcript and generate the summary in THE SAME LANGUAGE as the transcript. If the transcript is in German, write the summary in German. If it's in English, write in English. Match the source language exactly.

TRANSCRIPT:
${finalContent}

OUTPUT FORMAT - STRICT STRUCTURE (each section appears EXACTLY ONCE):
Use these headers in the DETECTED LANGUAGE of the transcript:
- For English: Meeting Purpose, Key Decisions, Action Items, Key Insights
- For German: Besprechungszweck, Wichtige Entscheidungen, Aktionspunkte, Wichtige Erkenntnisse
- For other languages: Translate the headers appropriately

• [Meeting Purpose header]: [One sentence describing what the meeting was about]

• [Key Decisions header]:
- [Decision 1]
- [Decision 2]

• [Action Items header]:
- [Action 1]
- [Action 2]

• [Key Insights header]:
- [Insight 1]

CRITICAL RULES:
1. ALWAYS write the summary in the SAME LANGUAGE as the transcript
2. Each section header must appear EXACTLY ONCE
3. Consolidate ALL decisions under a single header
4. Consolidate ALL action items under a single header
5. Total word count: 150-200 words maximum
6. Maximum 3-4 bullet points per section

Generate 4-6 topic tags that categorize the main themes (in the same language as the transcript).

Format your response as valid JSON:
{
  "summaryText": "• [Header]: ...\\n\\n• [Header]:\\n- ...",
  "topicTags": ["tag1", "tag2", "tag3", "tag4"]
}

Return valid JSON only, no markdown or extra text.`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are an expert meeting analyst. CRITICAL: Always detect the language of the transcript and generate summaries in THE SAME LANGUAGE. Generate summaries with EXACTLY four sections (with headers translated to the transcript's language): Meeting Purpose, Key Decisions, Action Items, and Key Insights. Each section header appears ONLY ONCE. Keep summaries to 150-200 words. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 8000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI summary error:", errorText);
    throw new Error(`Summary generation failed: ${response.status}`);
  }

  const result = await response.json();

  let content = "";
  if (result.output && Array.isArray(result.output)) {
    for (const item of result.output) {
      if (item.type === "message" && item.content) {
        for (const c of item.content) {
          if (c.type === "output_text" || c.type === "text") content += c.text || "";
        }
      }
    }
  }
  if (!content && result.choices?.[0]?.message?.content) {
    content = result.choices[0].message.content;
  }

  if (!content || content.trim() === "") {
    return generateFallbackSummary(selectedSegments);
  }

  try {
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();
    if (!jsonStr) return generateFallbackSummary(selectedSegments);

    const parsed = JSON.parse(jsonStr);
    return {
      summaryText: parsed.summaryText || "",
      topicTags: parsed.topicTags || [],
    };
  } catch {
    const summaryMatch = content.match(
      /"summaryText"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"topicTags"|"\s*}|$)/,
    );
    if (summaryMatch && summaryMatch[1]) {
      const extractedSummary = summaryMatch[1]
        .replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t").trim();
      const tagsMatch = content.match(/"topicTags"\s*:\s*\[([\s\S]*?)\]/);
      let extractedTags: string[] = [];
      if (tagsMatch && tagsMatch[1]) {
        extractedTags = tagsMatch[1]
          .split(",").map((t) => t.trim().replace(/^"|"$/g, "")).filter((t) => t.length > 0 && t !== '"');
      }
      return { summaryText: extractedSummary, topicTags: extractedTags };
    }
    if (content.length > 50 && !content.startsWith("{")) {
      return { summaryText: content, topicTags: [] };
    }
    return generateFallbackSummary(selectedSegments);
  }
}

export function generateFallbackSummary(segments: string[]): GeneratedSummary {
  const speakerPattern = /^\(([A-Z0-9]+)\)/;
  const speakers = new Set<string>();
  const words: string[] = [];

  for (const seg of segments.slice(0, 50)) {
    const match = seg.match(speakerPattern);
    if (match) speakers.add(match[1]);
    words.push(...seg.toLowerCase().split(/\s+/));
  }

  const topicCandidates = new Map<string, number>();
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "must", "shall", "can", "need", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "then", "there", "when", "where", "why", "how",
    "all", "some", "such", "not", "only", "so", "than", "too", "very", "just", "and",
    "but", "if", "or", "because", "while", "this", "that", "these", "those", "it",
    "its", "i", "you", "he", "she", "we", "they", "what", "which", "who", "yeah",
    "okay", "uh", "um", "like", "know", "think", "also", "about", "right",
  ]);

  for (const word of words) {
    if (word.length > 3 && !stopWords.has(word) && /^[a-z]+$/.test(word)) {
      topicCandidates.set(word, (topicCandidates.get(word) || 0) + 1);
    }
  }

  const topTopics = [...topicCandidates.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word]) => word);
  const speakerList = [...speakers].slice(0, 3);
  const participantText = speakerList.length > 0 ? `Participants: ${speakerList.join(", ")}.` : "";

  return {
    summaryText: `Meeting with ${segments.length} discussion segments. ${participantText}`,
    topicTags: topTopics.length > 0 ? topTopics : ["meeting"],
  };
}

/**
 * High-level entry point: fetch segments (if not provided) and generate a summary.
 */
export async function generateSummary(
  supabase: SupabaseClient,
  transcriptId: string,
  options: SummaryOptions,
  transcriptContent?: string,
): Promise<GeneratedSummary> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error("AI service not configured");

  let segments: string[];
  if (transcriptContent) {
    segments = transcriptContent.split("\n").filter((s) => s.trim());
  } else {
    segments = await fetchTranscriptSegments(supabase, transcriptId);
  }

  if (segments.length === 0) {
    throw new Error("No transcript content found");
  }

  return generateSummaryWithAI(segments, options, OPENAI_RESPONSES_URL, apiKey);
}

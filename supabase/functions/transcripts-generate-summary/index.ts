import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getOpenAIKey, CHAT_MODEL, OPENAI_RESPONSES_URL } from "../_shared/openai.ts";

// FR5.1 - Summary generation request
interface GenerateSummaryRequest {
  transcriptId: string;
  transcriptContent?: string; // Optional: if provided, use this instead of searching
  includeDecisions: boolean;
  includeActionItems: boolean;
  includeTopicTags: boolean;
}

// FR5.1 - Generated summary response
interface GeneratedSummary {
  summaryText: string;
  topicTags: string[];
}

/**
 * FR5.1 - Fetch transcript segments from Postgres (RLS-scoped to the caller)
 */
async function fetchTranscriptSegments(
  supabase: SupabaseClient,
  transcriptId: string,
): Promise<string[]> {
  console.log(`Fetching segments for transcript: ${transcriptId}`);

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
 * FR5.1 - Call Azure AI Foundry GPT-5.2-Chat to generate summary (Responses API)
 */
async function generateSummaryWithAI(
  segments: string[],
  options: { includeDecisions: boolean; includeActionItems: boolean; includeTopicTags: boolean },
  endpoint: string,
  apiKey: string,
): Promise<GeneratedSummary> {
  console.log("Generating summary with Azure AI Foundry GPT-5.2-Chat...");

  // With 150M tokens/min quota, we can be generous - take more segments for better coverage
  const maxSegments = 300;
  let selectedSegments: string[];

  if (segments.length <= maxSegments) {
    selectedSegments = segments;
  } else {
    // Sample from beginning, middle, and end for better coverage
    const beginCount = Math.floor(maxSegments * 0.4); // 40% from beginning
    const middleCount = Math.floor(maxSegments * 0.3); // 30% from middle
    const endCount = maxSegments - beginCount - middleCount; // 30% from end

    const middleStart = Math.floor(segments.length / 2) - Math.floor(middleCount / 2);

    selectedSegments = [
      ...segments.slice(0, beginCount),
      ...segments.slice(middleStart, middleStart + middleCount),
      ...segments.slice(-endCount),
    ];

    console.log(
      `Sampled ${selectedSegments.length} segments from ${segments.length} total (begin: ${beginCount}, middle: ${middleCount}, end: ${endCount})`,
    );
  }

  const transcriptText = selectedSegments.join("\n\n");

  // With large quota, allow more content for better summaries (~25k tokens)
  const maxChars = 100000;
  const finalContent =
    transcriptText.length > maxChars
      ? transcriptText.substring(0, maxChars) + "\n\n[Transcript truncated due to length...]"
      : transcriptText;

  console.log(`Transcript content length: ${finalContent.length} characters`);

  let prompt = `Analyze the following meeting transcript and generate a CONCISE executive summary.

IMPORTANT: Detect the language of the transcript and generate the summary in THE SAME LANGUAGE as the transcript. If the transcript is in German, write the summary in German. If it's in English, write in English. Match the source language exactly.

TRANSCRIPT:
${finalContent}

OUTPUT FORMAT - STRICT STRUCTURE (each section appears EXACTLY ONCE):
Use these headers in the DETECTED LANGUAGE of the transcript:
- For English: Meeting Purpose, Key Decisions, Action Items, Key Insights
- For German: Besprechungszweck, Wichtige Entscheidungen, Aktionspunkte, Wichtige Erkenntnisse
- For other languages: Translate the headers appropriately

• [Meeting Purpose header in transcript language]: [One sentence describing what the meeting was about]

• [Key Decisions header in transcript language]:
- [Decision 1]
- [Decision 2]
- [Decision 3 if applicable]

• [Action Items header in transcript language]:
- [Action 1]
- [Action 2]
- [Action 3 if applicable]

• [Key Insights header in transcript language]:
- [Insight 1]
- [Insight 2 if applicable]

CRITICAL RULES:
1. ALWAYS write the summary in the SAME LANGUAGE as the transcript
2. Each section header must appear EXACTLY ONCE
3. Consolidate ALL decisions under a single header
4. Consolidate ALL action items under a single header
5. Total word count: 150-200 words maximum
6. Maximum 3-4 bullet points per section
7. Use concise, direct language

Generate 4-6 topic tags that categorize the main themes (in the same language as the transcript).

Format your response as valid JSON:
{
  "summaryText": "• [Header]: ...\\n\\n• [Header]:\\n- ...\\n- ...\\n\\n• [Header]:\\n- ...\\n\\n• [Header]:\\n- ...",
  "topicTags": ["tag1", "tag2", "tag3", "tag4"]
}

Return valid JSON only, no markdown or extra text.`;

  // Use Responses API format for GPT-5.2-Chat
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
            "You are an expert meeting analyst. CRITICAL: Always detect the language of the transcript and generate summaries in THE SAME LANGUAGE. Generate summaries with EXACTLY four sections (with headers translated to the transcript's language): Meeting Purpose, Key Decisions, Action Items, and Key Insights. Each section header appears ONLY ONCE. Consolidate all related points under their single header. Keep summaries to 150-200 words. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_output_tokens: 8000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure AI Foundry error:", errorText);
    throw new Error(`Summary generation failed: ${response.status}`);
  }

  const result = await response.json();
  
  // Extract content from Responses API format
  let content = "";
  if (result.output && Array.isArray(result.output)) {
    for (const item of result.output) {
      if (item.type === "message" && item.content) {
        for (const c of item.content) {
          if (c.type === "output_text" || c.type === "text") {
            content += c.text || "";
          }
        }
      }
    }
  }
  // Fallback to Chat Completions format if Responses API format not found
  if (!content && result.choices?.[0]?.message?.content) {
    content = result.choices[0].message.content;
  }

  console.log(`AI response length: ${content.length} characters`);

  // Handle empty response
  if (!content || content.trim() === "") {
    console.error("AI returned empty response");
    return generateFallbackSummary(selectedSegments);
  }

  // Parse JSON response
  try {
    // Clean potential markdown code blocks
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith("```")) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    if (!jsonStr) {
      console.error("Empty JSON after cleaning");
      return generateFallbackSummary(selectedSegments);
    }

    const parsed = JSON.parse(jsonStr);
    return {
      summaryText: parsed.summaryText || "",
      topicTags: parsed.topicTags || [],
    };
  } catch (parseError) {
    console.error("Failed to parse AI response:", content.substring(0, 500));
    
    // Try to extract summaryText from truncated/malformed JSON
    const summaryMatch = content.match(/"summaryText"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"topicTags"|"\s*}|$)/);
    if (summaryMatch && summaryMatch[1]) {
      // Unescape JSON string and clean up
      let extractedSummary = summaryMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .trim();
      
      // Try to extract topicTags as well
      const tagsMatch = content.match(/"topicTags"\s*:\s*\[([\s\S]*?)\]/);
      let extractedTags: string[] = [];
      if (tagsMatch && tagsMatch[1]) {
        extractedTags = tagsMatch[1]
          .split(',')
          .map(t => t.trim().replace(/^"|"$/g, ''))
          .filter(t => t.length > 0 && t !== '"');
      }
      
      console.log("Recovered summary from malformed JSON, length:", extractedSummary.length);
      return {
        summaryText: extractedSummary,
        topicTags: extractedTags,
      };
    }
    
    // If content looks like a summary (not JSON), use it directly
    if (content.length > 50 && !content.startsWith("{")) {
      return {
        summaryText: content,
        topicTags: [],
      };
    }
    return generateFallbackSummary(selectedSegments);
  }
}

/**
 * Generate a basic fallback summary from transcript content
 */
function generateFallbackSummary(segments: string[]): GeneratedSummary {
  console.log("Generating fallback summary from content analysis");

  // Extract speakers and topics from content
  const speakerPattern = /^\(([A-Z0-9]+)\)/;
  const speakers = new Set<string>();
  const words: string[] = [];

  for (const seg of segments.slice(0, 50)) {
    const match = seg.match(speakerPattern);
    if (match) {
      speakers.add(match[1]);
    }
    words.push(...seg.toLowerCase().split(/\s+/));
  }

  // Extract potential topics
  const topicCandidates = new Map<string, number>();
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "and",
    "but",
    "if",
    "or",
    "because",
    "until",
    "while",
    "this",
    "that",
    "these",
    "those",
    "am",
    "it",
    "its",
    "i",
    "you",
    "he",
    "she",
    "we",
    "they",
    "what",
    "which",
    "who",
    "whom",
    "yeah",
    "okay",
    "ehm",
    "uh",
    "um",
    "like",
    "know",
    "think",
    "also",
    "about",
    "right",
  ]);

  for (const word of words) {
    if (word.length > 3 && !stopWords.has(word) && /^[a-z]+$/.test(word)) {
      topicCandidates.set(word, (topicCandidates.get(word) || 0) + 1);
    }
  }

  const topTopics = [...topicCandidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const speakerList = [...speakers].slice(0, 3);
  const participantText = speakerList.length > 0 ? `Participants: ${speakerList.join(", ")}.` : "";

  return {
    summaryText: `Meeting with ${segments.length} discussion segments. ${participantText}`,
    topicTags: topTopics.length > 0 ? topTopics : ["meeting"],
  };
}

serveWithAuth(async ({ req, supabase }) => {
  const {
    transcriptId,
    transcriptContent,
    includeDecisions = true,
    includeActionItems = true,
    includeTopicTags = true,
  }: GenerateSummaryRequest = await req.json();

  if (!transcriptId) {
    return json({ error: "Missing required field: transcriptId" }, 400);
  }

  const gpt52Endpoint = OPENAI_RESPONSES_URL;
  const gpt52ApiKey = getOpenAIKey();

  if (!gpt52ApiKey) {
    console.error("OPENAI_API_KEY not configured");
    return json({ error: "AI service not configured" }, 500);
  }

  console.log(`FR5.1 - Generating summary for transcript: ${transcriptId}`);

  let segments: string[];

  if (transcriptContent) {
    // Use provided content
    segments = transcriptContent.split("\n").filter((s: string) => s.trim());
    console.log(`Using provided content. Sample: ${transcriptContent.substring(0, 300)}`);
    // Check for specific terms to debug correction issues
    if (transcriptContent.toLowerCase().includes("agentic")) {
      console.log('Content contains "agentic" - correction applied');
    }
    if (transcriptContent.toLowerCase().includes("adjantic")) {
      console.log('WARNING: Content still contains "adjantic" - correction may not have been applied');
    }
  } else {
    segments = await fetchTranscriptSegments(supabase, transcriptId);
  }

  if (segments.length === 0) {
    return json({ error: "No transcript content found" }, 404);
  }

  console.log(`Processing ${segments.length} segments`);

  // Generate summary
  const summary = await generateSummaryWithAI(
    segments,
    { includeDecisions, includeActionItems, includeTopicTags },
    gpt52Endpoint,
    gpt52ApiKey,
  );

  console.log("FR5.1 - Summary generated successfully");

  return json({
    success: true,
    transcriptId,
    ...summary,
  });
});

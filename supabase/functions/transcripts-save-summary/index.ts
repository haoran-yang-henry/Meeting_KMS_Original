import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getOpenAIKey, MINI_MODEL, OPENAI_CHAT_COMPLETIONS_URL } from "../_shared/openai.ts";

interface SaveSummaryRequest {
  transcriptId: string;
  summaryText?: string; // Group summary - initial + after corrections
  personalSummary?: string; // Personal summary - user-adjusted via adjust_summary tool
  keywords?: string[];
  project?: string;
  topic?: string;
  topics?: string[]; // Alternative array format for topics
}

/**
 * Analyze summary text to determine project status using AI
 * Returns: "ongoing" | "positive" | "negative" | "warning"
 */
async function analyzeStatus(summaryText: string): Promise<string> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    console.log('OPENAI_API_KEY not configured, defaulting to ongoing');
    return 'ongoing';
  }

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MINI_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a project status analyzer. Analyze the meeting summary and determine the overall status/sentiment.

Return ONLY ONE of these exact words (no explanation, no punctuation):
- "ongoing" - neutral progress, routine updates, work in progress
- "positive" - good news, achievements, successful outcomes, milestones reached
- "negative" - problems, failures, blockers, serious issues
- "warning" - risks, concerns, potential issues, needs attention

Just return the single word.`
          },
          {
            role: 'user',
            content: `Analyze this meeting summary and return the status:\n\n${summaryText.slice(0, 2000)}`
          }
        ],
        max_completion_tokens: 20,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI status analysis failed:', response.status, errorText);
      return 'ongoing';
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.toLowerCase().trim() || 'ongoing';

    // Validate the response
    const validStatuses = ['ongoing', 'positive', 'negative', 'warning'];
    const status = validStatuses.find(s => result.includes(s)) || 'ongoing';

    console.log(`Status analysis result: ${status}`);
    return status;
  } catch (error) {
    console.error('Status analysis error:', error);
    return 'ongoing';
  }
}

serveWithAuth(async ({ req, user, supabase }) => {
  const { transcriptId, summaryText, personalSummary, keywords, project, topic, topics }: SaveSummaryRequest = await req.json();

  if (!transcriptId) {
    return json({ error: "Missing required field: transcriptId" }, 400);
  }

  // Determine if this is a full save or metadata-only update
  const isMetadataOnlyUpdate = summaryText === undefined && personalSummary === undefined;

  // Resolve topic from either topic (string) or topics (array)
  const resolvedTopic = topic !== undefined ? topic : (topics !== undefined ? topics[0] || "" : undefined);

  console.log(`${isMetadataOnlyUpdate ? "Updating metadata" : "Saving summary"} for transcript: ${transcriptId}`);

  // Only analyze status if we have summaryText (full save)
  let status: string | undefined;
  if (summaryText || personalSummary) {
    status = await analyzeStatus(summaryText || personalSummary || "");
  }

  // Merge semantics: only touch fields that were explicitly provided
  const mergeFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (summaryText !== undefined) mergeFields.summary_text = summaryText;
  if (personalSummary !== undefined) mergeFields.personal_summary = personalSummary;
  if (status !== undefined) mergeFields.status = status;
  if (keywords !== undefined) {
    mergeFields.tags = keywords.filter((k) => !k.startsWith("status:"));
  }
  if (resolvedTopic !== undefined) {
    mergeFields.topic = resolvedTopic;
    mergeFields.topics = resolvedTopic ? [resolvedTopic] : [];
  }
  if (project !== undefined) mergeFields.project = project;

  const { data: updated, error } = await supabase
    .from("transcripts")
    .update(mergeFields)
    .eq("id", transcriptId)
    .select("id");

  if (error) {
    console.error("Save summary error:", error);
    return json({ error: "Failed to save summary" }, 500);
  }

  if (!updated || updated.length === 0) {
    // Transcript row missing: create it if we at least have a summary
    if (!summaryText) {
      return json({ error: "Document not found. Cannot update metadata for non-existent transcript." }, 404);
    }
    console.log("Transcript not found, creating metadata row...");
    const { error: insertError } = await supabase.from("transcripts").insert({
      id: transcriptId,
      user_id: user.id,
      summary_text: summaryText,
      tags: keywords ? keywords.filter((k) => !k.startsWith("status:")) : [],
      topic: resolvedTopic || "",
      topics: resolvedTopic ? [resolvedTopic] : [],
      project: project || "",
      status: status || "ongoing",
    });
    if (insertError) {
      console.error("Insert fallback error:", insertError);
      return json({ error: "Failed to save summary" }, 500);
    }
  }

  console.log(isMetadataOnlyUpdate ? "Metadata updated successfully" : `Summary saved successfully with status: ${status}`);

  return json({
    success: true,
    transcriptId,
    status: status || "unchanged",
  });
});

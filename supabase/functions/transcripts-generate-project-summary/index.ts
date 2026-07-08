import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getOpenAIKey, CHAT_MODEL, OPENAI_RESPONSES_URL } from "../_shared/openai.ts";

interface GenerateProjectSummaryRequest {
  project: string;
  projectSummaryOverride?: string; // For saving edited project summary
}

interface TranscriptMetadata {
  id: string;
  title: string;
  summaryText: string;
  project: string;
}

// Fetch transcripts for a project (RLS-scoped to the caller)
async function fetchProjectTranscripts(
  supabase: SupabaseClient,
  project: string,
): Promise<TranscriptMetadata[]> {
  const { data, error } = await supabase
    .from("transcripts")
    .select("id, title, summary_text, project")
    .eq("project", project)
    .order("meeting_date", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Fetch project transcripts error:", error);
    throw new Error("Failed to fetch project transcripts");
  }

  console.log(`Fetched ${data?.length ?? 0} transcripts for project: ${project}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title || "Untitled",
    summaryText: row.summary_text || "",
    project: row.project,
  }));
}

serveWithAuth(async ({ req, user, supabase }) => {
  const { project, projectSummaryOverride }: GenerateProjectSummaryRequest = await req.json();

  if (!project) {
    return json({ success: false, error: "Project name is required" }, 400);
  }

  // CRITICAL: Fetch transcripts server-side to prevent race conditions
  const projectTranscripts = await fetchProjectTranscripts(supabase, project);

  // If no transcripts found, the project is empty (last meeting was deleted)
  if (projectTranscripts.length === 0) {
    console.log(`No transcripts found for project: ${project} - clearing project memory`);
    await supabase.from("project_memory").delete()
      .eq("scope", "project").eq("name", project);
    return json({
      success: true,
      projectSummary: null,
      project,
      meetingCount: 0,
      cleared: true,
      message: "Project has no meetings - memory cleared",
    });
  }

  // Filter to only transcripts with summaries
  const transcriptsWithSummaries = projectTranscripts.filter((t) => t.summaryText);

  if (transcriptsWithSummaries.length === 0 && !projectSummaryOverride) {
    console.log(`No summaries found for project: ${project} - waiting for indexing`);
    return json({
      success: true,
      projectSummary: null,
      project,
      meetingCount: 0,
      pending: true,
      message: "Meetings exist but no summaries indexed yet",
    });
  }

  let projectSummary: string;

  // If override is provided, use it directly without AI generation
  if (projectSummaryOverride) {
    console.log(`Saving edited project summary for: ${project}`);
    projectSummary = projectSummaryOverride;
  } else {
    console.log(`Generating project summary for: ${project} with ${transcriptsWithSummaries.length} summaries`);

    // Most recent first (already sorted by meeting_date desc)
    const sortedSummaries = [...transcriptsWithSummaries];
    const latestMeeting = sortedSummaries[0];
    const previousMeetings = sortedSummaries.slice(1);

    // Use the OpenAI chat model for project summary
    const OPENAI_ENDPOINT = OPENAI_RESPONSES_URL;
    const OPENAI_KEY = getOpenAIKey();
    if (!OPENAI_KEY) {
      console.error("OPENAI_API_KEY not configured");
      return json({ success: false, error: "AI service not configured" }, 500);
    }

    const systemPrompt = `You are a project memory generator. Create a CONCISE project-level summary (100-150 words max) with TWO sections:

**• Project Status:** (2-3 sentences)
- Overall progress and current state
- Key decisions and action items across all meetings

**• Update:** (1-2 sentences)
- What's new from the most recent meeting
- Any changes, new developments, or shifts in direction

Rules:
- Be extremely concise - every word must add value
- Use bullet points, not paragraphs
- Focus on actionable insights, not descriptions
- The Update section should highlight ONLY the latest meeting's contributions`;

    const userPrompt = `Generate a project memory for "${project}".

LATEST MEETING (for Update section):
${latestMeeting.title}
${latestMeeting.summaryText}

${previousMeetings.length > 0 ? `PREVIOUS MEETINGS (for context):
${previousMeetings.map((t) => `${t.title}: ${t.summaryText}`).join('\n\n')}` : '(No previous meetings)'}

Create a concise project memory with Project Status and Update sections.`;

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_output_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      return json({ success: false, error: "AI generation failed" }, 502);
    }

    const data = await response.json();
    // Extract text from Responses API format
    projectSummary = '';
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              projectSummary += contentItem.text;
            }
          }
        }
      }
    }
    projectSummary = projectSummary.trim();

    if (!projectSummary) {
      return json({ success: false, error: "No summary generated" }, 502);
    }
  }

  console.log(`Project summary ${projectSummaryOverride ? 'saved' : 'generated'} successfully for: ${project}`);

  // Save project memory (single row per project instead of merging into every doc)
  const { error: saveError } = await supabase.from("project_memory").upsert({
    user_id: user.id,
    scope: "project",
    name: project,
    summary_text: projectSummary,
    updated_at: new Date().toISOString(),
  });

  if (saveError) {
    console.error("Failed to save project summary:", saveError);
    return json({ success: false, error: "Failed to save project summary" }, 500);
  }

  return json({
    success: true,
    projectSummary,
    project,
    meetingCount: transcriptsWithSummaries.length,
  });
});

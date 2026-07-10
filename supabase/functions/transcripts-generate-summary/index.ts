import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { generateSummary } from "../_shared/summary.ts";

// FR5.1 - Summary generation request
interface GenerateSummaryRequest {
  transcriptId: string;
  transcriptContent?: string; // Optional: use this instead of fetching segments
  includeDecisions: boolean;
  includeActionItems: boolean;
  includeTopicTags: boolean;
}

// Thin HTTP shell over the shared summary pipeline (see _shared/summary.ts),
// so the desktop transcription worker can reuse the exact same logic.
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

  try {
    const summary = await generateSummary(
      supabase,
      transcriptId,
      { includeDecisions, includeActionItems, includeTopicTags },
      transcriptContent,
    );
    return json({ success: true, transcriptId, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Summary generation failed";
    console.error("generate-summary failed:", message);
    const status = message.includes("No transcript content") ? 404
      : message.includes("not configured") ? 500
      : 500;
    return json({ error: message }, status);
  }
});

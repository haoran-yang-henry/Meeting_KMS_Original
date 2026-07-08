import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";

interface FindByTitleRequest {
  meetingTitle: string;
}

serveWithAuth(async ({ req, supabase }) => {
  const { meetingTitle }: FindByTitleRequest = await req.json();

  if (!meetingTitle) {
    return json({ error: "Missing required field: meetingTitle" }, 400);
  }

  console.log(`Searching for existing transcript with title: ${meetingTitle}`);

  const { data, error } = await supabase
    .from("transcripts")
    .select("id, title, summary_text, tags")
    .eq("title", meetingTitle)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Find by title error:", error);
    return json({ error: "Lookup failed" }, 500);
  }

  if (data) {
    console.log(`Found existing transcript: ${data.id}`);
    return json({
      success: true,
      found: true,
      transcriptId: data.id,
      meetingTitle: data.title,
      summaryText: data.summary_text || null,
      summaryTags: data.tags || [],
    });
  }

  console.log("No existing transcript found");
  return json({ success: true, found: false, transcriptId: null });
});

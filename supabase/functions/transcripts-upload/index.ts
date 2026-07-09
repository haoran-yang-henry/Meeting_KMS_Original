import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { ingestTranscript, MAX_TRANSCRIPT_CHARS } from "../_shared/ingest.ts";

serveWithAuth(async ({ req, user, supabase }) => {
  const {
    transcript,
    title,
    date,
    duration,
    group,
    project,
    keywords,
    topic,
    fileType = "txt",
    state = "uploaded_raw",
  } = await req.json();

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return json({ error: "Transcript content is required" }, 400);
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return json({ error: "Transcript too large" }, 413);
  }

  try {
    const result = await ingestTranscript(supabase, user.id, transcript, {
      title,
      date,
      duration,
      group,
      project,
      keywords,
      topic,
      fileType,
      state,
    });

    return json({
      success: true,
      transcriptId: result.transcriptId,
      segmentCount: result.segmentCount,
      state: result.state,
      hasTimestamps: result.hasTimestamps,
    });
  } catch (error) {
    console.error("Upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return json({ error: message }, 500);
  }
});

import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getEmbeddingsBatched } from "../_shared/openai.ts";
import { parseTranscript, cleanSegments } from "../_shared/parser.ts";

// ~5M chars ≈ a full day of meetings; hard server-side cap against abuse
const MAX_TRANSCRIPT_CHARS = 5_000_000;

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

  // FR1.3 - Generate transcript ID
  const transcriptId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log("Processing transcript:", transcriptId);

  // FR1.3 - Parse and segment the transcript
  console.log("Step 1: Parsing transcript with format:", fileType);
  let segments = parseTranscript(transcript, fileType, transcriptId);
  segments = cleanSegments(segments);
  console.log(`Parsed and cleaned ${segments.length} segments`);

  if (segments.length === 0) {
    return json({ error: "No valid segments extracted from transcript" }, 400);
  }

  // Step 2: Generate embeddings for segments
  console.log("Step 2: Generating embeddings...");
  const embeddings = await getEmbeddingsBatched(segments.map((s) => s.text));
  console.log(`Generated ${embeddings.length} embeddings`);

  // Step 3: Insert transcript metadata row
  const hasTimestamps = segments.some((s) => s.startTime);
  const { error: metadataError } = await supabase.from("transcripts").insert({
    id: transcriptId,
    user_id: user.id,
    title: title || "Untitled Transcript",
    meeting_date: date || new Date().toISOString(),
    duration: duration || 0,
    group_name: group || "",
    project: project || "",
    keywords: keywords || "",
    topic: topic || "",
    topics: topic ? [topic] : [],
    tags: [],
    state,
    segment_count: segments.length,
    has_timestamps: hasTimestamps,
    transcript,
  });

  if (metadataError) {
    console.error("Insert transcript error:", metadataError);
    return json({ error: "Failed to store transcript" }, 500);
  }

  // Step 4: Insert segments with embeddings (batched to keep payloads small)
  const segmentRows = segments.map((segment, i) => ({
    id: `${transcriptId}_${segment.segmentId}`,
    transcript_id: transcriptId,
    user_id: user.id,
    segment_id: segment.segmentId,
    text: segment.text,
    speaker: segment.speaker || "",
    start_time: segment.startTime || "",
    end_time: segment.endTime || "",
    embedding: embeddings[i],
  }));

  const batchSize = 200;
  for (let i = 0; i < segmentRows.length; i += batchSize) {
    const batch = segmentRows.slice(i, i + batchSize);
    const { error: segmentError } = await supabase.from("segments").insert(batch);
    if (segmentError) {
      console.error("Insert segments error:", segmentError);
      // Roll back the half-written transcript (cascade removes segments)
      await supabase.from("transcripts").delete().eq("id", transcriptId);
      return json({ error: "Failed to store transcript segments" }, 500);
    }
  }

  console.log("Upload complete:", { transcriptId, segmentCount: segments.length, state });

  return json({
    success: true,
    transcriptId,
    segmentCount: segments.length,
    state,
    hasTimestamps,
  });
});

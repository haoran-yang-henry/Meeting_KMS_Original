import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getEmbeddingsBatched } from "../_shared/openai.ts";
import type { TranscriptSegment } from "../_shared/parser.ts";

// FR3.1 - Input request
interface AddToIndexRequest {
  transcriptId: string;
  segments: TranscriptSegment[];
  metadata: {
    meetingTitle: string;
    meetingDate?: string;
    project?: string;
    group?: string;
    tags?: string[];
    topics?: string[];
  };
  isCorrected: boolean; // FR3.1 - indicates if corrected version
}

serveWithAuth(async ({ req, user, supabase }) => {
  const { transcriptId, segments, metadata, isCorrected }: AddToIndexRequest =
    await req.json();

  if (!transcriptId || !segments || segments.length === 0) {
    return json({ error: "Missing required fields: transcriptId and segments" }, 400);
  }

  console.log(`FR3 - Adding transcript to index: ${transcriptId}`);
  console.log(`Using ${isCorrected ? "corrected" : "raw"} version with ${segments.length} segments`);

  // FR3.2 - Generate embeddings for each segment
  const embeddings = await getEmbeddingsBatched(segments.map((s) => s.text));
  console.log(`Generated ${embeddings.length} embeddings`);

  // FR3.4 - Upsert transcript metadata (indexing resets the stored summary,
  // matching the old Azure "upload" replace semantics; it is regenerated next)
  const { error: metadataError } = await supabase.from("transcripts").upsert({
    id: transcriptId,
    user_id: user.id,
    title: metadata.meetingTitle || "Untitled Transcript",
    meeting_date: metadata.meetingDate || new Date().toISOString(),
    project: metadata.project || "",
    group_name: metadata.group || "",
    tags: metadata.tags || [],
    topics: metadata.topics || [],
    state: "indexed",
    segment_count: segments.length,
    has_timestamps: segments.some((s) => s.startTime),
    summary_text: null,
    personal_summary: null,
    updated_at: new Date().toISOString(),
  });

  if (metadataError) {
    console.error("Upsert transcript error:", metadataError);
    return json({ error: "Failed to update transcript metadata" }, 500);
  }

  // FR3.3 - Replace segments: drop the previous version, insert the new one
  const { error: deleteError } = await supabase
    .from("segments")
    .delete()
    .eq("transcript_id", transcriptId);
  if (deleteError) {
    console.error("Delete old segments error:", deleteError);
    return json({ error: "Failed to replace segments" }, 500);
  }

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

  let successCount = 0;
  const batchSize = 200;
  for (let i = 0; i < segmentRows.length; i += batchSize) {
    const batch = segmentRows.slice(i, i + batchSize);
    const { error: segmentError } = await supabase.from("segments").insert(batch);
    if (segmentError) {
      console.error("Insert segments error:", segmentError);
      return json({ error: "Failed to store segments" }, 500);
    }
    successCount += batch.length;
  }

  // FR3.5 - Final state is "indexed"
  console.log(`FR3 Complete: ${successCount}/${segments.length} segments indexed`);

  return json({
    success: true,
    transcriptId,
    segmentsIndexed: successCount,
    totalSegments: segments.length,
    state: "indexed", // FR3.5
    isCorrected,
  });
});

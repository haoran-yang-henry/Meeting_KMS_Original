import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseTranscript, cleanSegments } from "./parser.ts";
import { getEmbeddingsBatched } from "./openai.ts";

// ~5M chars ≈ a full day of meetings; hard server-side cap against abuse
export const MAX_TRANSCRIPT_CHARS = 5_000_000;

export interface IngestMetadata {
  title?: string;
  date?: string;
  duration?: number;
  group?: string;
  project?: string;
  keywords?: string;
  topic?: string;
  fileType?: string;
  state?: string;
}

export interface IngestResult {
  transcriptId: string;
  segmentCount: number;
  hasTimestamps: boolean;
  state: string;
}

/**
 * Full ingestion pipeline: parse → clean → embed → store transcript + segments.
 * `supabase` must be the caller's RLS-scoped client so rows land under their user.
 * Throws Error with a user-safe message on failure (half-written data is rolled back).
 */
export async function ingestTranscript(
  supabase: SupabaseClient,
  userId: string,
  transcript: string,
  meta: IngestMetadata,
): Promise<IngestResult> {
  if (!transcript || !transcript.trim()) {
    throw new Error("Transcript content is required");
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error("Transcript too large");
  }

  const state = meta.state ?? "uploaded_raw";

  // FR1.3 - Generate transcript ID
  const transcriptId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log("Processing transcript:", transcriptId);

  // FR1.3 - Parse and segment the transcript
  console.log("Step 1: Parsing transcript with format:", meta.fileType ?? "txt");
  let segments = parseTranscript(transcript, meta.fileType ?? "txt", transcriptId);
  segments = cleanSegments(segments);
  console.log(`Parsed and cleaned ${segments.length} segments`);

  if (segments.length === 0) {
    throw new Error("No valid segments extracted from transcript");
  }

  // Step 2: Generate embeddings for segments
  console.log("Step 2: Generating embeddings...");
  const embeddings = await getEmbeddingsBatched(segments.map((s) => s.text));
  console.log(`Generated ${embeddings.length} embeddings`);

  // Step 3: Insert transcript metadata row
  const hasTimestamps = segments.some((s) => s.startTime);
  const { error: metadataError } = await supabase.from("transcripts").insert({
    id: transcriptId,
    user_id: userId,
    title: meta.title || "Untitled Transcript",
    meeting_date: meta.date || new Date().toISOString(),
    duration: meta.duration || 0,
    group_name: meta.group || "",
    project: meta.project || "",
    keywords: meta.keywords || "",
    topic: meta.topic || "",
    topics: meta.topic ? [meta.topic] : [],
    tags: [],
    state,
    segment_count: segments.length,
    has_timestamps: hasTimestamps,
    transcript,
  });

  if (metadataError) {
    console.error("Insert transcript error:", metadataError);
    throw new Error("Failed to store transcript");
  }

  // Step 4: Insert segments with embeddings (batched to keep payloads small)
  const segmentRows = segments.map((segment, i) => ({
    id: `${transcriptId}_${segment.segmentId}`,
    transcript_id: transcriptId,
    user_id: userId,
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
      throw new Error("Failed to store transcript segments");
    }
  }

  console.log("Ingestion complete:", { transcriptId, segmentCount: segments.length, state });

  return { transcriptId, segmentCount: segments.length, hasTimestamps, state };
}

import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";

interface DeleteRequest {
  transcriptId: string;
}

serveWithAuth(async ({ req, supabase }) => {
  const { transcriptId } = await req.json() as DeleteRequest;

  if (!transcriptId) {
    return json({ success: false, error: "transcriptId is required" }, 400);
  }

  console.log(`Deleting transcript: ${transcriptId}`);

  // Cascade removes the segments; RLS guarantees it is the caller's transcript
  const { data: deleted, error } = await supabase
    .from("transcripts")
    .delete()
    .eq("id", transcriptId)
    .select("id, segment_count");

  if (error) {
    console.error("Delete error:", error);
    return json({ success: false, error: "Failed to delete transcript" }, 500);
  }

  const deletedCount = deleted?.length
    ? 1 + (deleted[0].segment_count ?? 0)
    : 0;

  console.log(`Successfully deleted ${deletedCount} documents`);

  return json({
    success: true,
    deletedCount,
    message: `Deleted ${deletedCount} documents`,
  });
});

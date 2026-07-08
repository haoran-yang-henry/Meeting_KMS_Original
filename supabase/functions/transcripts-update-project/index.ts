import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";

interface UpdateProjectRequest {
  oldProjectName: string;
  newProjectName?: string; // If undefined/empty, this is a delete (set all to unassigned)
}

serveWithAuth(async ({ req, supabase }) => {
  const { oldProjectName, newProjectName }: UpdateProjectRequest = await req.json();

  if (!oldProjectName) {
    return json({ error: "Missing required field: oldProjectName" }, 400);
  }

  const isDelete = !newProjectName;
  const targetProject = isDelete ? "" : newProjectName;

  console.log(`${isDelete ? "Deleting" : "Renaming"} project: "${oldProjectName}" -> "${targetProject}"`);

  const { data: updated, error } = await supabase
    .from("transcripts")
    .update({ project: targetProject, updated_at: new Date().toISOString() })
    .eq("project", oldProjectName)
    .select("id");

  if (error) {
    console.error("Update project error:", error);
    return json({ error: "Failed to update project" }, 500);
  }

  // Keep project memory in sync (best effort; a rename collision just drops it)
  if (isDelete) {
    await supabase.from("project_memory").delete()
      .eq("scope", "project").eq("name", oldProjectName);
  } else {
    const { error: memoryError } = await supabase.from("project_memory")
      .update({ name: targetProject })
      .eq("scope", "project").eq("name", oldProjectName);
    if (memoryError) {
      console.error("Project memory rename failed:", memoryError);
      await supabase.from("project_memory").delete()
        .eq("scope", "project").eq("name", oldProjectName);
    }
  }

  const updatedCount = updated?.length ?? 0;
  console.log(`Successfully updated ${updatedCount} transcripts`);

  return json({
    success: true,
    updatedCount,
    oldProjectName,
    newProjectName: targetProject,
    action: isDelete ? "deleted" : "renamed",
  });
});

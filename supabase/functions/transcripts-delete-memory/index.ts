import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";

interface DeleteMemoryRequest {
  type: "project" | "organization";
  project?: string; // Required when type is 'project'
}

serveWithAuth(async ({ req, supabase }) => {
  const { type, project }: DeleteMemoryRequest = await req.json();

  if (!type || !["project", "organization"].includes(type)) {
    return json(
      { success: false, error: 'Invalid memory type. Must be "project" or "organization".' },
      400,
    );
  }

  if (type === "project" && !project) {
    return json(
      { success: false, error: "Project name is required for project memory deletion." },
      400,
    );
  }

  let query = supabase.from("project_memory").delete().eq("scope", type);
  if (type === "project") {
    query = query.eq("name", project!);
  }

  const { data: deleted, error } = await query.select("name");

  if (error) {
    console.error("Delete memory error:", error);
    return json({ success: false, error: `Failed to delete ${type} memory` }, 500);
  }

  const deletedCount = deleted?.length ?? 0;
  console.log(`Successfully cleared ${type} memory (${deletedCount} entries)`);

  return json({
    success: true,
    message: type === "project"
      ? `Project memory deleted for: ${project}`
      : "Organization memory deleted",
    deletedCount,
  });
});

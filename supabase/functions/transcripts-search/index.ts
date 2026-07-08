import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";

function parseKeywordsToTags(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof input !== "string") return [String(input)].map((s) => s.trim()).filter(Boolean);

  return input
    .split(/[,;\n\t·|]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

serveWithAuth(async ({ req, supabase }) => {
  const { query, top = 10, group, project, topic, unassigned } = await req.json();

  let dbQuery = supabase
    .from("transcripts")
    .select(
      "id, title, meeting_date, project, group_name, topic, topics, tags, keywords, summary_text, personal_summary, status",
      { count: "exact" },
    )
    .order("meeting_date", { ascending: false })
    .limit(Math.min(Number(top) || 10, 1000));

  if (group) dbQuery = dbQuery.eq("group_name", String(group));

  // Unassigned = meetings without a project
  if (unassigned) {
    dbQuery = dbQuery.eq("project", "");
  } else if (project) {
    dbQuery = dbQuery.eq("project", String(project));
  }

  if (topic) dbQuery = dbQuery.contains("topics", [String(topic)]);

  // Frontend always sends "*" / "" today; keep a simple keyword filter anyway
  if (query && query !== "*" && String(query).trim()) {
    const safe = String(query).trim().replace(/[,()%]/g, " ").slice(0, 200);
    dbQuery = dbQuery.or(`title.ilike.%${safe}%,keywords.ilike.%${safe}%`);
  }

  const { data, error, count } = await dbQuery;
  if (error) {
    console.error("Search error:", error);
    return json({ error: "Search failed" }, 500);
  }

  // Attach project / organization memory (one query, RLS-scoped to the user)
  const { data: memories } = await supabase
    .from("project_memory")
    .select("scope, name, summary_text");
  const projectSummaries = new Map<string, string>();
  let organizationSummary: string | null = null;
  for (const m of memories ?? []) {
    if (m.scope === "organization") organizationSummary = m.summary_text;
    else projectSummaries.set(m.name, m.summary_text);
  }

  const results = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title || row.id,
    date: row.meeting_date,
    project: row.project,
    group: row.group_name,
    topics: row.topics?.length ? row.topics : (row.topic ? [row.topic] : []),
    tags: row.tags?.length ? row.tags : parseKeywordsToTags(row.keywords),
    summaryText: row.summary_text,
    personalSummary: row.personal_summary,
    summaryTags: row.tags ?? [],
    status: row.status,
    projectSummary: row.project ? projectSummaries.get(row.project) ?? null : null,
    organizationSummary,
  }));

  return json({ results, count: count ?? results.length });
});

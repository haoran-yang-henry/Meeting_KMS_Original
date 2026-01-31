import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeODataString(value: string): string {
  // OData strings are single-quoted; escape single quotes by doubling them.
  return value.replaceAll("'", "''");
}

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

async function azureSearch(
  azureUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  label: string,
): Promise<any> {
  const resp = await fetch(azureUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (resp.ok) return await resp.json();

  const errorText = await resp.text();
  console.error(`[${label}] Azure Search error:`, errorText);

  // Retry with minimal body when schema differs (missing select/orderby fields)
  if (errorText.includes("Could not find a property") || errorText.includes("Invalid expression")) {
    const minimalBody: Record<string, unknown> = {
      search: body.search ?? "*",
      top: body.top ?? 10,
      filter: body.filter,
      count: true,
      queryType: body.queryType ?? "simple",
      searchMode: body.searchMode ?? "all",
    };

    console.log(`[${label}] Retrying with minimal body...`);
    const retry = await fetch(azureUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(minimalBody),
    });

    if (!retry.ok) {
      const retryErr = await retry.text();
      console.error(`[${label}] Retry also failed:`, retryErr);
      throw new Error(`Azure Search error: ${retry.status} - ${retryErr}`);
    }

    return await retry.json();
  }

  throw new Error(`Azure Search error: ${resp.status} - ${errorText}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, top = 10, group, project, topic, unassigned } = await req.json();

    const endpoint = Deno.env.get("AZURE_SEARCH_ENDPOINT");
    const apiKey = Deno.env.get("AZURE_SEARCH_API_KEY");
    const indexName = Deno.env.get("AZURE_SEARCH_INDEX_NAME");

    if (!endpoint || !apiKey || !indexName) {
      throw new Error("Azure Search credentials not configured");
    }

    const azureUrl = `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;

    // 1) Primary path: metadata documents
    const metadataFilters: string[] = ["docType eq 'metadata'"];

    if (group) metadataFilters.push(`group eq '${escapeODataString(String(group))}'`);
    
    // Handle unassigned filter - meetings without a project
    if (unassigned) {
      // Filter for documents where project is null or empty string
      metadataFilters.push(`(project eq null or project eq '')`);
    } else if (project) {
      metadataFilters.push(`project eq '${escapeODataString(String(project))}'`);
    }

    // topics is an array field on metadata docs; also support older single-string field `topic`
    if (topic) {
      const safe = escapeODataString(String(topic));
      metadataFilters.push(`(topics/any(t: t eq '${safe}') or topic eq '${safe}')`);
    }

    const metadataFilterString = metadataFilters.join(" and ");

    const metadataBody: Record<string, unknown> = {
      search: query || "*",
      searchMode: "all",
      queryType: "simple",
      top,
      select:
        "id,docType,transcriptId,meetingTitle,meetingDate,project,group,topics,tags,summaryText,personalSummary,summaryTags,status,projectSummary,organizationSummary,title,date,topic,keywords",
      orderby: "meetingDate desc",
      filter: metadataFilterString,
      count: true,
    };

    console.log("Searching Azure AI Search (metadata):", query || "*", "filters:", metadataFilterString);

    const metadataResult = await azureSearch(azureUrl, apiKey, metadataBody, "metadata");
    const metadataDocs = metadataResult.value || [];

    if (metadataDocs.length > 0) {
      const mappedResults = metadataDocs.map((doc: any) => ({
        id: doc.id,
        title: doc.meetingTitle || doc.title || doc.id,
        date: doc.meetingDate || doc.date,
        project: doc.project,
        group: doc.group,
        topics: doc.topics || (doc.topic ? [doc.topic] : []),
        tags: doc.tags || parseKeywordsToTags(doc.keywords),
        summaryText: doc.summaryText,
        personalSummary: doc.personalSummary,
        summaryTags: doc.summaryTags,
        status: doc.status,
        projectSummary: doc.projectSummary,
        organizationSummary: doc.organizationSummary,
      }));

      return new Response(
        JSON.stringify({
          results: mappedResults,
          count: metadataResult["@odata.count"] || mappedResults.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Fallback: segment documents (covers older/partial indexes where metadata docs are missing or have different docType)
    const segmentFilters: string[] = ["docType eq 'segment'"];
    if (group) segmentFilters.push(`group eq '${escapeODataString(String(group))}'`);
    
    // Handle unassigned filter for segments as well
    if (unassigned) {
      segmentFilters.push(`(project eq null or project eq '')`);
    } else if (project) {
      segmentFilters.push(`project eq '${escapeODataString(String(project))}'`);
    }
    
    if (topic) segmentFilters.push(`topic eq '${escapeODataString(String(topic))}'`);
    const segmentFilterString = segmentFilters.join(" and ");

    // We fetch more rows than requested so we can dedupe by transcriptId.
    const fetchTop = Math.min(1000, Math.max(Number(top) * 50, 200));

    const segmentBody: Record<string, unknown> = {
      search: query || "*",
      searchMode: "all",
      queryType: "simple",
      top: fetchTop,
      select: "id,docType,transcriptId,title,meetingTitle,date,meetingDate,project,group,topic,topics,tags,keywords",
      orderby: "date desc",
      filter: segmentFilterString,
      count: true,
    };

    console.log(
      "No metadata results; falling back to segments. Query:",
      query || "*",
      "filters:",
      segmentFilterString,
      "top:",
      fetchTop,
    );

    const segmentResult = await azureSearch(azureUrl, apiKey, segmentBody, "segments");
    const segmentDocs = segmentResult.value || [];

    // Deduplicate by transcriptId
    const seen = new Map<string, any>();
    for (const doc of segmentDocs) {
      const tid = doc.transcriptId || doc.id;
      if (!tid) continue;
      if (!seen.has(tid)) seen.set(tid, doc);
      if (seen.size >= Number(top)) break;
    }

    const mappedResults = Array.from(seen.values()).map((doc: any) => ({
      id: doc.transcriptId || doc.id,
      title: doc.meetingTitle || doc.title || doc.transcriptId || doc.id,
      date: doc.meetingDate || doc.date,
      project: doc.project,
      group: doc.group,
      topics: doc.topics || (doc.topic ? [doc.topic] : []),
      tags: doc.tags || parseKeywordsToTags(doc.keywords),
      summaryText: doc.summaryText,
      personalSummary: doc.personalSummary,
      summaryTags: doc.summaryTags,
      status: doc.status,
      projectSummary: doc.projectSummary,
      organizationSummary: doc.organizationSummary,
    }));

    return new Response(
      JSON.stringify({
        results: mappedResults,
        count: mappedResults.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in transcripts-search:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

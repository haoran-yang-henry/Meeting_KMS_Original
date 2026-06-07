import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CHAT_MODEL, openaiConfigured, responsesFetch } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateProjectSummaryRequest {
  project: string;
  projectSummaryOverride?: string; // For saving edited project summary
}

interface TranscriptMetadata {
  id: string;
  title: string;
  summaryText: string;
  project: string;
}

// Fetch transcripts for a project directly from Azure AI Search
async function fetchProjectTranscripts(project: string): Promise<TranscriptMetadata[]> {
  const AZURE_SEARCH_ENDPOINT = Deno.env.get('AZURE_SEARCH_ENDPOINT');
  const AZURE_SEARCH_API_KEY = Deno.env.get('AZURE_SEARCH_API_KEY');
  const AZURE_SEARCH_INDEX_NAME = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

  if (!AZURE_SEARCH_ENDPOINT || !AZURE_SEARCH_API_KEY || !AZURE_SEARCH_INDEX_NAME) {
    throw new Error('Azure Search configuration is missing');
  }

  const searchUrl = `${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-11-01`;
  
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AZURE_SEARCH_API_KEY,
    },
    body: JSON.stringify({
      search: '*',
      filter: `docType eq 'metadata' and project eq '${project}'`,
      select: 'id,meetingTitle,summaryText,project',
      top: 50,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Azure Search error:', response.status, errorText);
    throw new Error(`Failed to fetch project transcripts: ${response.status}`);
  }

  const data = await response.json();
  const results = data.value || [];
  
  console.log(`Fetched ${results.length} transcripts for project: ${project}`);
  
  return results.map((doc: any) => ({
    id: doc.id,
    title: doc.meetingTitle || 'Untitled',
    summaryText: doc.summaryText || '',
    project: doc.project,
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project, projectSummaryOverride }: GenerateProjectSummaryRequest = await req.json();

    if (!project) {
      return new Response(
        JSON.stringify({ success: false, error: 'Project name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // CRITICAL: Fetch transcripts server-side to prevent race conditions
    // This ensures we always update the correct project's documents
    const projectTranscripts = await fetchProjectTranscripts(project);
    
    // If no transcripts found, the project is empty (last meeting was deleted)
    // Return success with cleared state - this is a valid scenario
    if (projectTranscripts.length === 0) {
      console.log(`No transcripts found for project: ${project} - project memory cleared`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          projectSummary: null,
          project,
          meetingCount: 0,
          cleared: true,
          message: 'Project has no meetings - memory cleared'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to only transcripts with summaries
    const transcriptsWithSummaries = projectTranscripts.filter(t => t.summaryText);
    
    if (transcriptsWithSummaries.length === 0 && !projectSummaryOverride) {
      console.log(`No summaries found for project: ${project} - waiting for indexing`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          projectSummary: null,
          project,
          meetingCount: 0,
          pending: true,
          message: 'Meetings exist but no summaries indexed yet'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let projectSummary: string;

    // If override is provided, use it directly without AI generation
    if (projectSummaryOverride) {
      console.log(`Saving edited project summary for: ${project}`);
      projectSummary = projectSummaryOverride;
    } else {
      console.log(`Generating project summary for: ${project} with ${transcriptsWithSummaries.length} summaries`);

      // Sort by date (most recent first) to identify the latest meeting
      // We'll use the first summary as the "latest" for the Update section
      const sortedSummaries = [...transcriptsWithSummaries];
      const latestMeeting = sortedSummaries[0];
      const previousMeetings = sortedSummaries.slice(1);

      // Prepare the combined summaries text from server-fetched data
      const summariesText = sortedSummaries
        .map((t, i) => `Meeting ${i + 1}: ${t.title}\nSummary: ${t.summaryText}`)
        .join('\n\n');

      // Use OpenAI for project summary
      if (!openaiConfigured()) {
        throw new Error('OPENAI_API_KEY is not configured');
      }

      const systemPrompt = `You are a project memory generator. Create a CONCISE project-level summary (100-150 words max) with TWO sections:

**• Project Status:** (2-3 sentences)
- Overall progress and current state
- Key decisions and action items across all meetings

**• Update:** (1-2 sentences)
- What's new from the most recent meeting
- Any changes, new developments, or shifts in direction

Rules:
- Be extremely concise - every word must add value
- Use bullet points, not paragraphs
- Focus on actionable insights, not descriptions
- The Update section should highlight ONLY the latest meeting's contributions`;

      const userPrompt = `Generate a project memory for "${project}".

LATEST MEETING (for Update section):
${latestMeeting.title}
${latestMeeting.summaryText}

${previousMeetings.length > 0 ? `PREVIOUS MEETINGS (for context):
${previousMeetings.map((t, i) => `${t.title}: ${t.summaryText}`).join('\n\n')}` : '(No previous meetings)'}

Create a concise project memory with Project Status and Update sections.`;

      const response = await responsesFetch({
          model: CHAT_MODEL,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_output_tokens: 1000,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI gateway error:', response.status, errorText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      // Extract text from Responses API format
      projectSummary = '';
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && item.content && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                projectSummary += contentItem.text;
              }
            }
          }
        }
      }
      projectSummary = projectSummary.trim();

      if (!projectSummary) {
        throw new Error('No summary generated');
      }
    }

    console.log(`Project summary ${projectSummaryOverride ? 'saved' : 'generated'} successfully for: ${project}`);

    // Save project summary to all metadata documents with this project
    const AZURE_SEARCH_ENDPOINT = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const AZURE_SEARCH_API_KEY = Deno.env.get('AZURE_SEARCH_API_KEY');
    const AZURE_SEARCH_INDEX_NAME = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!AZURE_SEARCH_ENDPOINT || !AZURE_SEARCH_API_KEY || !AZURE_SEARCH_INDEX_NAME) {
      throw new Error('Azure Search configuration is missing');
    }

    // Update ONLY the documents that belong to this project (server-verified)
    const updateDocuments = projectTranscripts.map(transcript => ({
      "@search.action": "merge",
      "id": transcript.id,
      "projectSummary": projectSummary,
    }));

    const updateResponse = await fetch(
      `${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}/docs/index?api-version=2023-11-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': AZURE_SEARCH_API_KEY,
        },
        body: JSON.stringify({ value: updateDocuments }),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to save project summary to Azure Search:', errorText);
      throw new Error('Failed to save project summary');
    }

    console.log(`Project summary saved to ${projectTranscripts.length} metadata documents for project: ${project}`);

    return new Response(
      JSON.stringify({
        success: true,
        projectSummary,
        project,
        meetingCount: transcriptsWithSummaries.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating project summary:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

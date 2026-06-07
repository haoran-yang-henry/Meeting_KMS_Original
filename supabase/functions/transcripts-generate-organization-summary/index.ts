import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CHAT_MODEL, openaiConfigured, responsesFetch } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateOrgSummaryRequest {
  organizationSummaryOverride?: string; // For saving edited organization summary
}

interface TranscriptMetadata {
  id: string;
  title: string;
  summaryText: string;
  project: string;
  projectSummary: string;
}

// Fetch all transcripts from Azure AI Search
async function fetchAllTranscripts(): Promise<TranscriptMetadata[]> {
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
      filter: `docType eq 'metadata'`,
      select: 'id,meetingTitle,summaryText,project,projectSummary',
      top: 200,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Azure Search error:', response.status, errorText);
    throw new Error(`Failed to fetch transcripts: ${response.status}`);
  }

  const data = await response.json();
  const results = data.value || [];
  
  console.log(`Fetched ${results.length} transcripts for organization summary`);
  
  return results.map((doc: any) => ({
    id: doc.id,
    title: doc.meetingTitle || 'Untitled',
    summaryText: doc.summaryText || '',
    project: doc.project || '',
    projectSummary: doc.projectSummary || '',
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organizationSummaryOverride }: GenerateOrgSummaryRequest = await req.json();

    // Fetch all transcripts
    const allTranscripts = await fetchAllTranscripts();
    
    if (allTranscripts.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No transcripts found in the organization' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let organizationSummary: string;

    // If override is provided, use it directly without AI generation
    if (organizationSummaryOverride) {
      console.log('Saving edited organization summary');
      organizationSummary = organizationSummaryOverride;
    } else {
      console.log(`Generating organization summary from ${allTranscripts.length} transcripts`);

      // Group transcripts by project and build context
      const projectGroups: Record<string, TranscriptMetadata[]> = {};
      for (const t of allTranscripts) {
        const projectKey = t.project || 'Unassigned';
        if (!projectGroups[projectKey]) {
          projectGroups[projectKey] = [];
        }
        projectGroups[projectKey].push(t);
      }

      // Build context from project summaries and individual summaries
      let contextText = '';
      for (const [project, transcripts] of Object.entries(projectGroups)) {
        contextText += `\n## Project: ${project}\n`;
        
        // Add project summary if available
        const projectSummary = transcripts.find(t => t.projectSummary)?.projectSummary;
        if (projectSummary) {
          contextText += `Project Summary: ${projectSummary}\n`;
        }
        
        // Add individual meeting summaries
        const meetingSummaries = transcripts.filter(t => t.summaryText);
        if (meetingSummaries.length > 0) {
          contextText += `Meetings (${meetingSummaries.length}):\n`;
          for (const meeting of meetingSummaries) {
            contextText += `- ${meeting.title}: ${meeting.summaryText}\n`;
          }
        }
      }

      // Use OpenAI for organization summary
      if (!openaiConfigured()) {
        throw new Error('OPENAI_API_KEY is not configured');
      }

      const systemPrompt = `You are an organizational summary generator. Your task is to create a high-level organizational summary by synthesizing all project summaries and meeting information across the entire organization.

Focus on:
- Strategic initiatives and company-wide themes
- Cross-project dependencies and synergies
- Key organizational decisions and their impact
- Company-wide action items and priorities
- Overall organizational health and progress
- Potential risks or blockers affecting multiple projects

Keep the summary concise (4-6 sentences) and actionable, suitable for executive-level review.`;

      const userPrompt = `Generate an organizational summary based on all projects and meetings:

${contextText}

Provide a cohesive organization-level summary that captures the overall state, strategic direction, and key priorities across the entire organization.`;

      const response = await responsesFetch({
          model: CHAT_MODEL,
          input: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_output_tokens: 1500,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('AI gateway error:', response.status, errorText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const data = await response.json();
      // Extract text from Responses API format
      organizationSummary = '';
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && item.content && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === 'output_text' && contentItem.text) {
                organizationSummary += contentItem.text;
              }
            }
          }
        }
      }
      organizationSummary = organizationSummary.trim();

      if (!organizationSummary) {
        throw new Error('No summary generated');
      }
    }

    console.log(`Organization summary ${organizationSummaryOverride ? 'saved' : 'generated'} successfully`);

    // Save organization summary to all metadata documents
    const AZURE_SEARCH_ENDPOINT = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const AZURE_SEARCH_API_KEY = Deno.env.get('AZURE_SEARCH_API_KEY');
    const AZURE_SEARCH_INDEX_NAME = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!AZURE_SEARCH_ENDPOINT || !AZURE_SEARCH_API_KEY || !AZURE_SEARCH_INDEX_NAME) {
      throw new Error('Azure Search configuration is missing');
    }

    // Update all metadata documents with the organization summary
    const updateDocuments = allTranscripts.map(transcript => ({
      "@search.action": "merge",
      "id": transcript.id,
      "organizationSummary": organizationSummary,
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
      console.error('Failed to save organization summary to Azure Search:', updateResponse.status, errorText);
      // If the field doesn't exist, we need to inform the user
      if (errorText.includes('organizationSummary')) {
        throw new Error('The organizationSummary field needs to be added to your Azure AI Search index schema');
      }
      throw new Error(`Failed to save organization summary: ${errorText}`);
    }

    console.log(`Organization summary saved to ${allTranscripts.length} metadata documents`);

    return new Response(
      JSON.stringify({
        success: true,
        organizationSummary,
        projectCount: Object.keys(
          allTranscripts.reduce((acc, t) => { acc[t.project || 'Unassigned'] = true; return acc; }, {} as Record<string, boolean>)
        ).length,
        meetingCount: allTranscripts.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating organization summary:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

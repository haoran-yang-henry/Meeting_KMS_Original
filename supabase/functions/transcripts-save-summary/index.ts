import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chatCompletionsFetch, NANO_MODEL, openaiConfigured } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SaveSummaryRequest {
  transcriptId: string;
  summaryText?: string;  // Group summary - initial + after corrections
  personalSummary?: string;  // Personal summary - user-adjusted via adjust_summary tool
  keywords?: string[];
  project?: string;
  topic?: string;
  topics?: string[];  // Alternative array format for topics
}

/**
 * Analyze summary text to determine project status using AI
 * Returns: "ongoing" | "positive" | "negative" | "warning"
 */
async function analyzeStatus(summaryText: string): Promise<string> {
  if (!openaiConfigured()) {
    console.log('OPENAI_API_KEY not configured, defaulting to ongoing');
    return 'ongoing';
  }

  try {
    const response = await chatCompletionsFetch({
        model: NANO_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are a project status analyzer. Analyze the meeting summary and determine the overall status/sentiment.
            
Return ONLY ONE of these exact words (no explanation, no punctuation):
- "ongoing" - neutral progress, routine updates, work in progress
- "positive" - good news, achievements, successful outcomes, milestones reached
- "negative" - problems, failures, blockers, serious issues
- "warning" - risks, concerns, potential issues, needs attention

Just return the single word.`
          },
          {
            role: 'user',
            content: `Analyze this meeting summary and return the status:\n\n${summaryText.slice(0, 2000)}`
          }
        ],
        max_tokens: 10,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI status analysis failed:', response.status, errorText);
      return 'ongoing';
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content?.toLowerCase().trim() || 'ongoing';
    
    // Validate the response
    const validStatuses = ['ongoing', 'positive', 'negative', 'warning'];
    const status = validStatuses.find(s => result.includes(s)) || 'ongoing';
    
    console.log(`Status analysis result: ${status}`);
    return status;
  } catch (error) {
    console.error('Status analysis error:', error);
    return 'ongoing';
  }
}

async function updateMetadataDocument(
  transcriptId: string,
  summaryText: string | undefined,
  personalSummary: string | undefined,
  keywords: string[] | undefined,
  project: string | undefined,
  topic: string | undefined,
  status: string | undefined,
  searchEndpoint: string,
  searchApiKey: string,
  indexName: string
): Promise<boolean> {
  console.log(`Updating metadata document for transcript: ${transcriptId}`);
  console.log(`Project: ${project}, Topic: ${topic}, Status: ${status}, Keywords: ${keywords?.join(', ') || 'none provided'}`);
  
  const azureUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2023-11-01`;
  
  // Build update document with only provided fields to avoid overwriting existing data
  const mergeFields: Record<string, any> = {
    "@search.action": "merge",
    id: transcriptId,
  };
  
  // Only include fields that were explicitly provided
  if (summaryText !== undefined) {
    mergeFields.summaryText = summaryText;
  }
  
  if (personalSummary !== undefined) {
    mergeFields.personalSummary = personalSummary;
  }
  
  if (status !== undefined) {
    mergeFields.status = status;
  }
  
  if (keywords !== undefined) {
    const cleanKeywords = keywords.filter(k => !k.startsWith('status:'));
    mergeFields.tags = cleanKeywords;
  }
  
  if (topic !== undefined) {
    mergeFields.topics = topic ? [topic] : [];
  }
  
  if (project !== undefined) {
    mergeFields.project = project;
  }
  
  const updateDocument = {
    value: [mergeFields]
  };

  console.log('Merge document:', JSON.stringify(updateDocument));

  const response = await fetch(azureUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': searchApiKey,
    },
    body: JSON.stringify(updateDocument),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Azure Search update error:', errorText);
    
    // If merging failed and we have summaryText, try upload
    if ((response.status === 404 || errorText.includes('not found')) && summaryText) {
      console.log('Document not found, attempting upload...');
      
      const uploadDocument = {
        value: [{
          "@search.action": "upload",
          id: transcriptId,
          docType: "metadata",
          transcriptId: transcriptId,
          summaryText: summaryText,
          tags: keywords ? keywords.filter(k => !k.startsWith('status:')) : [],
          topics: topic ? [topic] : [],
          project: project || '',
          status: status || 'ongoing',
        }]
      };

      const uploadResponse = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify(uploadDocument),
      });

      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        console.error('Azure Search upload error:', uploadError);
        throw new Error(`Failed to save summary: ${uploadResponse.status}`);
      }
    } else if (response.status === 404 || errorText.includes('not found')) {
      throw new Error('Document not found. Cannot update metadata for non-existent transcript.');
    } else {
      throw new Error(`Failed to update: ${response.status}`);
    }
  }

  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcriptId, summaryText, personalSummary, keywords, project, topic, topics }: SaveSummaryRequest = await req.json();

    if (!transcriptId) {
      throw new Error('Missing required field: transcriptId');
    }

    // Determine if this is a full save or metadata-only update
    const isMetadataOnlyUpdate = summaryText === undefined && personalSummary === undefined;
    
    // Resolve topic from either topic (string) or topics (array)
    const resolvedTopic = topic !== undefined ? topic : (topics !== undefined ? topics[0] || '' : undefined);

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    console.log(`${isMetadataOnlyUpdate ? 'Updating metadata' : 'Saving summary'} for transcript: ${transcriptId}`);
    if (personalSummary) {
      console.log('Personal summary provided (from adjust_summary tool)');
    }

    // Only analyze status if we have summaryText (full save)
    let status: string | undefined;
    if (summaryText || personalSummary) {
      status = await analyzeStatus(summaryText || personalSummary || '');
    }

    await updateMetadataDocument(
      transcriptId,
      summaryText,
      personalSummary,
      keywords,
      project,
      resolvedTopic,
      status,
      searchEndpoint,
      searchApiKey,
      indexName
    );

    console.log(isMetadataOnlyUpdate ? 'Metadata updated successfully' : 'Summary saved successfully with status:', status);

    return new Response(
      JSON.stringify({
        success: true,
        transcriptId,
        status: status || 'unchanged',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-save-summary:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FindByTitleRequest {
  meetingTitle: string;
}

interface MetadataDocument {
  id: string;
  transcriptId: string;
  meetingTitle: string;
  summaryText?: string;
  summaryTags?: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { meetingTitle }: FindByTitleRequest = await req.json();

    if (!meetingTitle) {
      throw new Error('Missing required field: meetingTitle');
    }

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    console.log(`Searching for existing transcript with title: ${meetingTitle}`);

    // Search for metadata document with matching meetingTitle
    const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;
    
    const searchBody = {
      search: "*",
      filter: `docType eq 'metadata' and meetingTitle eq '${meetingTitle.replace(/'/g, "''")}'`,
      select: "id,transcriptId,meetingTitle,summaryText,summaryTags",
      top: 1
    };

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': searchApiKey,
      },
      body: JSON.stringify(searchBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Azure Search error:', errorText);
      throw new Error(`Azure Search failed: ${response.status}`);
    }

    const result = await response.json();
    const documents = result.value || [];

    if (documents.length > 0) {
      const existing = documents[0] as MetadataDocument;
      console.log(`Found existing transcript: ${existing.transcriptId}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          found: true,
          transcriptId: existing.transcriptId,
          meetingTitle: existing.meetingTitle,
          summaryText: existing.summaryText || null,
          summaryTags: existing.summaryTags || [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('No existing transcript found');
    return new Response(
      JSON.stringify({
        success: true,
        found: false,
        transcriptId: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-find-by-title:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

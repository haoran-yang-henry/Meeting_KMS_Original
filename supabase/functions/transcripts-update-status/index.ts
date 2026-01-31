import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateStatusRequest {
  transcriptId: string;
  status: 'ongoing' | 'positive' | 'negative' | 'warning';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcriptId, status }: UpdateStatusRequest = await req.json();

    if (!transcriptId || !status) {
      throw new Error('Missing required fields: transcriptId and status');
    }

    const validStatuses = ['ongoing', 'positive', 'negative', 'warning'];
    if (!validStatuses.includes(status)) {
      throw new Error('Invalid status value');
    }

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    console.log(`Updating status for transcript ${transcriptId} to ${status}`);

    const azureUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2023-11-01`;

    const updateDocument = {
      value: [{
        "@search.action": "merge",
        id: transcriptId,
        status: status,
      }]
    };

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
      throw new Error(`Failed to update status: ${response.status}`);
    }

    console.log('Status updated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        transcriptId,
        status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-update-status:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

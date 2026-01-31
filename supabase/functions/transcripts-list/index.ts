import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const endpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const apiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!endpoint || !apiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    // List all transcripts
    const azureUrl = `${endpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;
    
    const searchBody = {
      search: '*',
      orderby: 'date desc',
      top: 100,
      count: true
    };

    console.log('Listing all transcripts');

    const azureResponse = await fetch(azureUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(searchBody),
    });

    if (!azureResponse.ok) {
      const errorText = await azureResponse.text();
      console.error('Azure Search error:', errorText);
      throw new Error(`Azure Search error: ${azureResponse.status} - ${errorText}`);
    }

    const result = await azureResponse.json();
    console.log('List successful:', result.value?.length, 'transcripts');

    return new Response(
      JSON.stringify({ 
        transcripts: result.value || [], 
        count: result['@odata.count'] || 0 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-list:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
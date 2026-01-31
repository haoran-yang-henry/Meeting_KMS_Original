import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    console.log('Fetching all document IDs from index...');

    // First, get all document IDs
    const searchResponse = await fetch(
      `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2024-07-01`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify({
          search: '*',
          select: 'id',
          top: 10000, // Maximum batch size
        }),
      }
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      throw new Error(`Failed to fetch documents: ${searchResponse.status} - ${errorText}`);
    }

    const searchResult = await searchResponse.json();
    const documents = searchResult.value || [];

    if (documents.length === 0) {
      console.log('No documents found in index');
      return new Response(
        JSON.stringify({ success: true, message: 'Index is already empty', deletedCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${documents.length} documents to delete`);

    // Prepare delete actions
    const deleteActions = documents.map((doc: { id: string }) => ({
      '@search.action': 'delete',
      id: doc.id,
    }));

    // Delete in batches of 1000 (Azure Search limit)
    const batchSize = 1000;
    let deletedCount = 0;

    for (let i = 0; i < deleteActions.length; i += batchSize) {
      const batch = deleteActions.slice(i, i + batchSize);
      
      console.log(`Deleting batch ${Math.floor(i / batchSize) + 1}...`);

      const deleteResponse = await fetch(
        `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2024-07-01`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': searchApiKey,
          },
          body: JSON.stringify({ value: batch }),
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        throw new Error(`Failed to delete batch: ${deleteResponse.status} - ${errorText}`);
      }

      deletedCount += batch.length;
    }

    console.log(`Successfully deleted ${deletedCount} documents`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Deleted ${deletedCount} documents from index`,
        deletedCount 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error deleting documents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

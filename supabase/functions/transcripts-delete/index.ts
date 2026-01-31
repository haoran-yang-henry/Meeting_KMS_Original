import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteRequest {
  transcriptId: string;
}

function escapeODataString(value: string): string {
  return value.replaceAll("'", "''");
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcriptId } = await req.json() as DeleteRequest;

    if (!transcriptId) {
      return new Response(
        JSON.stringify({ success: false, error: 'transcriptId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Deleting all documents for transcriptId: ${transcriptId}`);

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    const safeId = escapeODataString(transcriptId);

    let totalDeleted = 0;
    let hasMoreDocuments = true;

    // Loop until all documents are deleted (handles pagination for large transcripts)
    while (hasMoreDocuments) {
      // Find documents with this transcriptId (segments) OR the metadata doc whose id == transcriptId
      const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2024-07-01`;

      const searchResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify({
          search: '*',
          filter: `(transcriptId eq '${safeId}' or id eq '${safeId}')`,
          select: 'id',
          top: 1000, // Azure AI Search batch limit
        }),
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        console.error('Search error:', errorText);
        throw new Error(`Failed to search for documents: ${errorText}`);
      }

      const searchResult = await searchResponse.json();
      const documents = searchResult.value || [];

      console.log(`Found ${documents.length} documents in this batch`);

      if (documents.length === 0) {
        hasMoreDocuments = false;
        break;
      }

      // Delete all found documents in this batch
      const deleteActions = documents.map((doc: { id: string }) => ({
        '@search.action': 'delete',
        id: doc.id,
      }));

      const deleteUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2024-07-01`;

      const deleteResponse = await fetch(deleteUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify({ value: deleteActions }),
      });

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        console.error('Delete error:', errorText);
        throw new Error(`Failed to delete documents: ${errorText}`);
      }

      totalDeleted += documents.length;
      console.log(`Deleted batch of ${documents.length} documents. Total deleted: ${totalDeleted}`);

      // If we got fewer than 1000, we've deleted everything
      if (documents.length < 1000) {
        hasMoreDocuments = false;
      }

      // Small delay to avoid rate limiting
      if (hasMoreDocuments) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`Successfully deleted ${totalDeleted} total documents`);

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount: totalDeleted,
        message: `Deleted ${totalDeleted} documents`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error deleting transcript:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

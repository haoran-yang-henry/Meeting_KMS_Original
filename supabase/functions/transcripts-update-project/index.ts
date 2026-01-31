import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateProjectRequest {
  oldProjectName: string;
  newProjectName?: string;  // If undefined/empty, this is a delete (set all to unassigned)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { oldProjectName, newProjectName }: UpdateProjectRequest = await req.json();

    if (!oldProjectName) {
      throw new Error('Missing required field: oldProjectName');
    }

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    const isDelete = !newProjectName;
    const targetProject = isDelete ? '' : newProjectName;
    
    console.log(`${isDelete ? 'Deleting' : 'Renaming'} project: "${oldProjectName}" -> "${targetProject}"`);

    // Step 1: Find all documents with the old project name
    const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;
    
    const searchBody = {
      search: "*",
      filter: `project eq '${oldProjectName.replace(/'/g, "''")}'`,
      select: "id",
      top: 1000,
    };

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': searchApiKey,
      },
      body: JSON.stringify(searchBody),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Azure Search query error:', errorText);
      throw new Error(`Failed to search documents: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const documents = searchData.value || [];
    
    console.log(`Found ${documents.length} documents to update`);

    if (documents.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          updatedCount: 0,
          message: 'No documents found with this project name',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Batch update all documents with new project name
    const updateUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2023-11-01`;
    
    const updateDocuments = documents.map((doc: { id: string }) => ({
      "@search.action": "merge",
      id: doc.id,
      project: targetProject,
    }));

    // Azure Search supports up to 1000 documents per batch
    const batchSize = 1000;
    let totalUpdated = 0;

    for (let i = 0; i < updateDocuments.length; i += batchSize) {
      const batch = updateDocuments.slice(i, i + batchSize);
      
      const updateResponse = await fetch(updateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify({ value: batch }),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Azure Search update error:', errorText);
        throw new Error(`Failed to update documents: ${updateResponse.status}`);
      }

      totalUpdated += batch.length;
      console.log(`Updated batch: ${batch.length} documents`);
    }

    console.log(`Successfully updated ${totalUpdated} documents`);

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount: totalUpdated,
        oldProjectName,
        newProjectName: targetProject,
        action: isDelete ? 'deleted' : 'renamed',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-update-project:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

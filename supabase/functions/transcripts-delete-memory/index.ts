import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteMemoryRequest {
  type: 'project' | 'organization';
  project?: string; // Required when type is 'project'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, project }: DeleteMemoryRequest = await req.json();

    if (!type || !['project', 'organization'].includes(type)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid memory type. Must be "project" or "organization".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'project' && !project) {
      return new Response(
        JSON.stringify({ success: false, error: 'Project name is required for project memory deletion.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const AZURE_SEARCH_ENDPOINT = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const AZURE_SEARCH_API_KEY = Deno.env.get('AZURE_SEARCH_API_KEY');
    const AZURE_SEARCH_INDEX_NAME = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!AZURE_SEARCH_ENDPOINT || !AZURE_SEARCH_API_KEY || !AZURE_SEARCH_INDEX_NAME) {
      throw new Error('Azure Search configuration is missing');
    }

    // First, fetch the documents we need to update
    const searchUrl = `${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-11-01`;
    
    let filter = `docType eq 'metadata'`;
    if (type === 'project' && project) {
      filter += ` and project eq '${project}'`;
    }

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AZURE_SEARCH_API_KEY,
      },
      body: JSON.stringify({
        search: '*',
        filter,
        select: 'id',
        top: 200,
      }),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Azure Search error:', searchResponse.status, errorText);
      throw new Error(`Failed to fetch documents: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const documents = searchData.value || [];

    if (documents.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: type === 'project' 
            ? `No documents found for project: ${project}` 
            : 'No documents found in the organization',
          deletedCount: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${documents.length} documents to clear ${type} memory`);

    // Prepare update documents to clear the appropriate summary field
    const fieldToClear = type === 'project' ? 'projectSummary' : 'organizationSummary';
    const updateDocuments = documents.map((doc: any) => ({
      "@search.action": "merge",
      "id": doc.id,
      [fieldToClear]: null,
    }));

    // Update documents in Azure Search
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
      console.error('Failed to clear memory in Azure Search:', errorText);
      throw new Error(`Failed to delete ${type} memory`);
    }

    console.log(`Successfully cleared ${type} memory from ${documents.length} documents`);

    return new Response(
      JSON.stringify({
        success: true,
        message: type === 'project' 
          ? `Project memory deleted for: ${project}` 
          : 'Organization memory deleted',
        deletedCount: documents.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error deleting memory:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

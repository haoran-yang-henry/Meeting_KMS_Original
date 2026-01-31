import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// FR3 - Segment structure for indexing
interface TranscriptSegment {
  segmentId: string;
  transcriptId: string;
  text: string;
  startTime?: string;
  endTime?: string;
  speaker?: string;
}

interface EmbeddedSegment extends TranscriptSegment {
  embedding: number[];
}

// FR3.1 - Input request
interface AddToIndexRequest {
  transcriptId: string;
  segments: TranscriptSegment[];
  metadata: {
    meetingTitle: string;
    meetingDate?: string;
    project?: string;
    group?: string;
    tags?: string[];
    topics?: string[];
  };
  isCorrected: boolean; // FR3.1 - indicates if corrected version
}

/**
 * FR3.2 - Get embeddings from Azure AI Foundry
 */
async function getEmbeddings(texts: string[], endpoint: string, apiKey: string): Promise<number[][]> {
  console.log(`Generating embeddings for ${texts.length} segments...`);
  console.log(`Using endpoint: ${endpoint.substring(0, 50)}...`);
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({ input: texts }),
  });

  const responseText = await response.text();
  console.log(`Embedding API response status: ${response.status}`);
  console.log(`Embedding API response length: ${responseText.length} chars`);
  
  if (!response.ok) {
    console.error('Azure AI Foundry embedding error:', responseText);
    throw new Error(`Embedding error: ${response.status} - ${responseText}`);
  }

  if (!responseText || responseText.trim() === '') {
    throw new Error('Embedding API returned empty response');
  }

  const result = JSON.parse(responseText);
  
  if (!result.data || !Array.isArray(result.data)) {
    console.error('Unexpected response structure:', JSON.stringify(result).substring(0, 500));
    throw new Error('Embedding API returned unexpected structure');
  }
  
  console.log(`Generated ${result.data.length} embeddings with ${result.data[0]?.embedding?.length || 0} dimensions`);
  return result.data.map((item: { embedding: number[] }) => item.embedding);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcriptId, segments, metadata, isCorrected }: AddToIndexRequest = await req.json();

    // Validate required inputs
    if (!transcriptId || !segments || segments.length === 0) {
      throw new Error('Missing required fields: transcriptId and segments');
    }

    // Get Azure credentials
    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');
    const foundryEndpoint = Deno.env.get('AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_ENDPOINT');
    const foundryApiKey = Deno.env.get('AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_API_KEY');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    if (!foundryEndpoint || !foundryApiKey) {
      throw new Error('Azure AI Foundry Text Embedding credentials not configured');
    }

    console.log(`FR3 - Adding transcript to index: ${transcriptId}`);
    console.log(`Using ${isCorrected ? 'corrected' : 'raw'} version with ${segments.length} segments`);

    // FR3.2 - Generate embeddings for each segment
    const segmentTexts = segments.map(s => s.text);
    const embeddedSegments: EmbeddedSegment[] = [];
    
    const batchSize = 16;
    for (let i = 0; i < segmentTexts.length; i += batchSize) {
      const batch = segmentTexts.slice(i, i + batchSize);
      console.log(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(segmentTexts.length / batchSize)}`);
      
      const embeddings = await getEmbeddings(batch, foundryEndpoint, foundryApiKey);
      
      for (let j = 0; j < batch.length; j++) {
        embeddedSegments.push({
          ...segments[i + j],
          embedding: embeddings[j],
        });
      }
    }
    console.log(`Generated ${embeddedSegments.length} embeddings`);

    const azureUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2023-11-01`;

    // FR3.4 - Upload transcript-level metadata document
    console.log('FR3.4 - Uploading transcript metadata document...');
    const metadataDocument = {
      value: [{
        "@search.action": "upload",
        id: transcriptId,
        docType: "metadata",
        transcriptId: transcriptId,
        meetingTitle: metadata.meetingTitle || 'Untitled Transcript',
        meetingDate: metadata.meetingDate || new Date().toISOString(),
        project: metadata.project || '',
        group: metadata.group || '',
        tags: metadata.tags || [],
        topics: metadata.topics || [],
        summaryText: '',
        summaryTags: [],
        summaryUpdatedAt: null,
        rawTranscriptStoragePath: null,
        correctedTranscriptStoragePath: isCorrected ? `corrected/${transcriptId}` : null,
        version: 1,
      }]
    };

    const metadataResponse = await fetch(azureUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': searchApiKey,
      },
      body: JSON.stringify(metadataDocument),
    });

    if (!metadataResponse.ok) {
      const errorText = await metadataResponse.text();
      console.error('Azure Search metadata error:', errorText);
      throw new Error(`Metadata upload error: ${metadataResponse.status} - ${errorText}`);
    }

    // FR3.3 - Upload segment documents with embeddings
    console.log('FR3.3 - Uploading segment documents to Azure AI Search...');
    const segmentDocuments = embeddedSegments.map(segment => ({
      "@search.action": "upload",
      id: `${transcriptId}_${segment.segmentId}`,
      docType: "segment",
      segmentId: segment.segmentId,
      transcriptId: transcriptId,
      text: segment.text,
      startTime: segment.startTime || null,
      endTime: segment.endTime || null,
      project: metadata.project || null,
      group: metadata.group || null,
      topics: metadata.topics || [],
      embedding: segment.embedding,
    }));

    // Upload segments in batches
    const segmentBatchSize = 100;
    let successCount = 0;
    for (let i = 0; i < segmentDocuments.length; i += segmentBatchSize) {
      const batch = segmentDocuments.slice(i, i + segmentBatchSize);
      console.log(`Uploading segment batch ${Math.floor(i / segmentBatchSize) + 1}/${Math.ceil(segmentDocuments.length / segmentBatchSize)}`);
      
      const segmentResponse = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': searchApiKey,
        },
        body: JSON.stringify({ value: batch }),
      });

      if (!segmentResponse.ok) {
        const errorText = await segmentResponse.text();
        console.error('Azure Search segment error:', errorText);
        // Continue with other batches even if one fails
      } else {
        successCount += batch.length;
      }
    }

    // FR3.5 - Final state is "indexed"
    console.log(`FR3 Complete: ${successCount}/${embeddedSegments.length} segments indexed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        transcriptId,
        segmentsIndexed: successCount,
        totalSegments: embeddedSegments.length,
        state: 'indexed', // FR3.5
        isCorrected,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-add-to-index:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

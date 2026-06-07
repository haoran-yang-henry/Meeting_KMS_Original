import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embedTexts, openaiConfigured } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TranscriptChunk {
  id: string;
  text: string;
  chunkIndex: number;
  startPosition: number;
  endPosition: number;
}

interface EmbeddedChunk extends TranscriptChunk {
  embedding: number[];
}

// Chunk transcript by sentences or fixed size
function chunkTranscript(transcript: string, chunkSize: number = 500, overlap: number = 50): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  
  // Split by sentences first
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) || [transcript];
  
  let currentChunk = '';
  let chunkIndex = 0;
  let startPosition = 0;
  let currentPosition = 0;
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `chunk_${chunkIndex}`,
        text: currentChunk.trim(),
        chunkIndex,
        startPosition,
        endPosition: currentPosition,
      });
      
      // Handle overlap - keep some of the previous chunk
      const overlapText = currentChunk.slice(-overlap);
      startPosition = currentPosition - overlapText.length;
      currentChunk = overlapText + sentence;
      chunkIndex++;
    } else {
      currentChunk += sentence;
    }
    currentPosition += sentence.length;
  }
  
  // Add remaining chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: `chunk_${chunkIndex}`,
      text: currentChunk.trim(),
      chunkIndex,
      startPosition,
      endPosition: currentPosition,
    });
  }
  
  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transcript, documentId, metadata } = await req.json();

    if (!openaiConfigured()) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript content is required');
    }

    console.log('Chunking transcript for document:', documentId);
    
    // Chunk the transcript
    const chunks = chunkTranscript(transcript);
    console.log(`Created ${chunks.length} chunks`);

    // Get embeddings for all chunks (batch processing)
    const chunkTexts = chunks.map(c => c.text);
    
    // Process in batches of 16 to avoid API limits
    const batchSize = 16;
    const embeddedChunks: EmbeddedChunk[] = [];
    
    for (let i = 0; i < chunkTexts.length; i += batchSize) {
      const batch = chunkTexts.slice(i, i + batchSize);
      console.log(`Processing embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunkTexts.length / batchSize)}`);
      
      const embeddings = await embedTexts(batch);
      
      for (let j = 0; j < batch.length; j++) {
        embeddedChunks.push({
          ...chunks[i + j],
          embedding: embeddings[j],
        });
      }
    }

    console.log(`Successfully embedded ${embeddedChunks.length} chunks`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        documentId,
        chunks: embeddedChunks,
        metadata,
        chunkCount: embeddedChunks.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-embed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

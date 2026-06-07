import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { embedTexts, openaiConfigured } from "../_shared/openai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// FR1.3 - Segment structure
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

// VTT/SRT parsing patterns
const VTT_TIMESTAMP_REGEX = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/;
const SRT_TIMESTAMP_REGEX = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;
const BRACKET_TIMESTAMP_REGEX = /\[(\d{1,2}:\d{2}:\d{2})\]/;
const SPEAKER_REGEX = /^([A-Za-z\s]+):\s*/;
const CUE_NUMBER_REGEX = /^\d+$/;

/**
 * Detect if content is VTT/SRT format
 * More robust detection for various SRT/VTT variations
 */
function isVTTFormat(content: string): boolean {
  const trimmedContent = content.trim();
  
  // Check for WEBVTT header
  if (trimmedContent.startsWith('WEBVTT')) return true;
  
  // Check for timestamp arrows (with or without surrounding spaces)
  // SRT can have "00:00:00,000 --> 00:00:05,000" or "00:00:00,000-->00:00:05,000"
  if (content.includes('-->')) return true;
  
  // Check if first 50 lines contain timestamp patterns (scan more lines)
  const lines = content.split('\n').slice(0, 50);
  let cueNumberCount = 0;
  let timestampCount = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Count cue numbers (pure digits)
    if (CUE_NUMBER_REGEX.test(trimmed)) {
      cueNumberCount++;
    }
    
    // Check for timestamp patterns
    if (VTT_TIMESTAMP_REGEX.test(trimmed) || SRT_TIMESTAMP_REGEX.test(trimmed)) {
      timestampCount++;
    }
    
    // Also check for standalone timestamps like "00:41:17,320"
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3}$/.test(trimmed)) {
      timestampCount++;
    }
  }
  
  // If we found multiple cue numbers and timestamps, it's likely SRT
  if (cueNumberCount >= 3 && timestampCount >= 2) {
    console.log(`SRT auto-detected: ${cueNumberCount} cue numbers, ${timestampCount} timestamps`);
    return true;
  }
  
  // If we found timestamps, it's likely VTT/SRT
  if (timestampCount >= 2) {
    console.log(`VTT/SRT auto-detected: ${timestampCount} timestamps found`);
    return true;
  }
  
  return false;
}

/**
 * Parse timestamp string to seconds for comparison
 */
function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

/**
 * Check if text ends with sentence-ending punctuation
 */
function endsWithSentence(text: string): boolean {
  const trimmed = text.trim();
  return /[.!?。！？]$/.test(trimmed);
}

/**
 * Check if text starts with continuation indicators
 */
function startsWithContinuation(text: string): boolean {
  const trimmed = text.trim();
  const continuationPatterns = /^(and|but|or|so|because|then|however|also|which|that|who|where|when|[a-z])/i;
  return /^[a-z]/.test(trimmed) || continuationPatterns.test(trimmed);
}

/**
 * Check if a line is likely metadata/noise rather than content
 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  
  // Empty
  if (!trimmed) return true;
  
  // Pure cue number (e.g., "435")
  if (CUE_NUMBER_REGEX.test(trimmed)) return true;
  
  // VTT/SRT timestamp line
  if (VTT_TIMESTAMP_REGEX.test(trimmed) || SRT_TIMESTAMP_REGEX.test(trimmed)) return true;
  
  // WEBVTT header or NOTE
  if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE')) return true;
  
  // Very short and likely noise (single digits, random chars)
  if (trimmed.length < 3 && !/[a-zA-Z]/.test(trimmed)) return true;
  
  return false;
}

/**
 * FR1.3 - Parse VTT/SRT format with semantic merging
 */
function parseVTT(content: string, transcriptId: string): TranscriptSegment[] {
  const rawSegments: Array<{
    startTime: string;
    endTime: string;
    text: string;
    speaker?: string;
  }> = [];
  
  const lines = content.split('\n');
  let currentSegment: { startTime: string; endTime: string; text: string; speaker?: string } | null = null;
  
  // First pass: extract raw timestamp-based segments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Skip WEBVTT header and NOTEs
    if (trimmedLine === 'WEBVTT' || trimmedLine === '' || trimmedLine.startsWith('NOTE')) {
      continue;
    }
    
    // Skip pure cue numbers (e.g., "1", "435")
    if (CUE_NUMBER_REGEX.test(trimmedLine)) {
      continue;
    }
    
    // Check for timestamp line
    const timestampMatch = trimmedLine.match(VTT_TIMESTAMP_REGEX) || trimmedLine.match(SRT_TIMESTAMP_REGEX);
    if (timestampMatch) {
      // Save previous segment if it has text
      if (currentSegment && currentSegment.text.trim()) {
        rawSegments.push({ ...currentSegment, text: currentSegment.text.trim() });
      }
      // Start new segment
      currentSegment = {
        startTime: timestampMatch[1].replace(',', '.'),
        endTime: timestampMatch[2].replace(',', '.'),
        text: '',
      };
      continue;
    }
    
    // If we have a current segment, this line is text content
    if (currentSegment) {
      // Check for speaker pattern
      const speakerMatch = trimmedLine.match(SPEAKER_REGEX);
      if (speakerMatch) {
        currentSegment.speaker = speakerMatch[1].trim();
        currentSegment.text += trimmedLine.replace(SPEAKER_REGEX, '') + ' ';
      } else {
        currentSegment.text += trimmedLine + ' ';
      }
    }
  }
  
  // Don't forget the last segment
  if (currentSegment && currentSegment.text.trim()) {
    rawSegments.push({ ...currentSegment, text: currentSegment.text.trim() });
  }
  
  if (rawSegments.length === 0) {
    console.log('VTT parser found no segments, falling back to plain text');
    return parsePlainText(content, transcriptId);
  }

  console.log(`VTT parser extracted ${rawSegments.length} raw segments`);

  // Second pass: AGGRESSIVE semantic merging (语义合并)
  // Goal: Reduce 605 raw segments to ~80-120 semantic chunks
  const mergedSegments: TranscriptSegment[] = [];
  let mergeBuffer: typeof rawSegments = [rawSegments[0]];
  const MAX_MERGE_GAP_SECONDS = 10.0;  // Allow larger gaps - speakers often pause
  const MAX_MERGED_LENGTH = 1500;  // Much larger chunks for better semantic context
  const MIN_MERGED_LENGTH = 200;   // Don't create tiny segments

  for (let i = 1; i < rawSegments.length; i++) {
    const prev = mergeBuffer[mergeBuffer.length - 1];
    const curr = rawSegments[i];
    
    const prevEnd = timestampToSeconds(prev.endTime);
    const currStart = timestampToSeconds(curr.startTime);
    const timeGap = currStart - prevEnd;
    
    const currentBufferLength = mergeBuffer.reduce((sum, s) => sum + s.text.length, 0);
    const combinedLength = currentBufferLength + curr.text.length;
    
    const sameSpeaker = prev.speaker === curr.speaker || (!prev.speaker && !curr.speaker);
    const prevEndsComplete = endsWithSentence(prev.text);
    const closeInTime = timeGap >= 0 && timeGap < MAX_MERGE_GAP_SECONDS;
    const withinLengthLimit = combinedLength <= MAX_MERGED_LENGTH;
    const bufferTooShort = currentBufferLength < MIN_MERGED_LENGTH;
    
    // AGGRESSIVE MERGE CONDITIONS:
    // 1. Always merge if buffer is too short (< 200 chars) and within max length
    // 2. Merge if same speaker and close in time and within length
    // 3. Merge if previous doesn't end with sentence and within length
    const shouldMerge = withinLengthLimit && (
      bufferTooShort ||
      (sameSpeaker && closeInTime) ||
      (!prevEndsComplete && closeInTime)
    );
    
    if (shouldMerge) {
      mergeBuffer.push(curr);
    } else {
      // Flush buffer as one merged segment
      const firstSeg = mergeBuffer[0];
      const lastSeg = mergeBuffer[mergeBuffer.length - 1];
      const mergedText = mergeBuffer.map(s => s.text).join(' ');
      
      mergedSegments.push({
        segmentId: `seg_${mergedSegments.length}`,
        transcriptId,
        text: mergedText.trim(),
        startTime: firstSeg.startTime,
        endTime: lastSeg.endTime,
        speaker: firstSeg.speaker,
      });
      
      mergeBuffer = [curr];
    }
  }
  
  // Flush remaining buffer
  if (mergeBuffer.length > 0) {
    const firstSeg = mergeBuffer[0];
    const lastSeg = mergeBuffer[mergeBuffer.length - 1];
    const mergedText = mergeBuffer.map(s => s.text).join(' ');
    
    mergedSegments.push({
      segmentId: `seg_${mergedSegments.length}`,
      transcriptId,
      text: mergedText.trim(),
      startTime: firstSeg.startTime,
      endTime: lastSeg.endTime,
      speaker: firstSeg.speaker,
    });
  }
  
  console.log(`Semantic merging: ${rawSegments.length} raw -> ${mergedSegments.length} merged segments`);
  
  return mergedSegments;
}

/**
 * FR1.3 - Parse plain text with optional timestamps
 */
function parsePlainText(content: string, transcriptId: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = content.split('\n');
  
  let segmentIndex = 0;
  let buffer = '';
  let bufferStartTime: string | undefined;
  let bufferSpeaker: string | undefined;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip noise lines
    if (isNoiseLine(trimmedLine)) {
      // If we have accumulated text, flush it
      if (buffer.trim()) {
        segments.push({
          segmentId: `seg_${segmentIndex}`,
          transcriptId,
          text: buffer.trim(),
          startTime: bufferStartTime,
          speaker: bufferSpeaker,
        });
        segmentIndex++;
        buffer = '';
        bufferStartTime = undefined;
        bufferSpeaker = undefined;
      }
      continue;
    }
    
    let text = trimmedLine;
    let startTime: string | undefined;
    let speaker: string | undefined;
    
    // Extract bracket timestamp if present
    const bracketMatch = trimmedLine.match(BRACKET_TIMESTAMP_REGEX);
    if (bracketMatch) {
      startTime = bracketMatch[1];
      text = trimmedLine.replace(BRACKET_TIMESTAMP_REGEX, '').trim();
    }
    
    // Extract speaker if present
    const speakerMatch = text.match(SPEAKER_REGEX);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = text.replace(SPEAKER_REGEX, '').trim();
    }
    
    if (text) {
      // Check if we should start a new segment or continue buffering
      if (speaker !== bufferSpeaker || buffer.length > 500) {
        // Flush existing buffer
        if (buffer.trim()) {
          segments.push({
            segmentId: `seg_${segmentIndex}`,
            transcriptId,
            text: buffer.trim(),
            startTime: bufferStartTime,
            speaker: bufferSpeaker,
          });
          segmentIndex++;
        }
        buffer = text + ' ';
        bufferStartTime = startTime;
        bufferSpeaker = speaker;
      } else {
        buffer += text + ' ';
        if (!bufferStartTime && startTime) bufferStartTime = startTime;
      }
    }
  }
  
  // Flush remaining buffer
  if (buffer.trim()) {
    segments.push({
      segmentId: `seg_${segmentIndex}`,
      transcriptId,
      text: buffer.trim(),
      startTime: bufferStartTime,
      speaker: bufferSpeaker,
    });
  }
  
  // If still no segments, split by paragraphs
  if (segments.length === 0) {
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim() && !isNoiseLine(p.trim()));
    paragraphs.forEach((para, idx) => {
      segments.push({
        segmentId: `seg_${idx}`,
        transcriptId,
        text: para.trim(),
      });
    });
  }
  
  return segments;
}

/**
 * FR1.3 - Parse JSON transcript format
 */
function parseJSON(content: string, transcriptId: string): TranscriptSegment[] {
  try {
    const data = JSON.parse(content);
    
    if (Array.isArray(data)) {
      return data.map((item, idx) => ({
        segmentId: `seg_${idx}`,
        transcriptId,
        text: item.text || item.content || String(item),
        startTime: item.startTime || item.start,
        endTime: item.endTime || item.end,
        speaker: item.speaker,
      }));
    }
    
    if (data.segments && Array.isArray(data.segments)) {
      return data.segments.map((item: any, idx: number) => ({
        segmentId: `seg_${idx}`,
        transcriptId,
        text: item.text || item.content || String(item),
        startTime: item.startTime || item.start,
        endTime: item.endTime || item.end,
        speaker: item.speaker,
      }));
    }
    
    if (data.transcript) {
      return parseTranscript(data.transcript, 'txt', transcriptId);
    }
    
    return parsePlainText(JSON.stringify(data), transcriptId);
  } catch {
    return parsePlainText(content, transcriptId);
  }
}

/**
 * FR1.3 - Main parsing function with auto-detection
 */
function parseTranscript(content: string, fileType: string, transcriptId: string): TranscriptSegment[] {
  const ext = fileType.toLowerCase().replace('.', '');
  
  // Explicit VTT/SRT
  if (ext === 'vtt' || ext === 'srt') {
    console.log('Parsing as VTT/SRT (explicit file type)');
    return parseVTT(content, transcriptId);
  }
  
  // Explicit JSON
  if (ext === 'json') {
    console.log('Parsing as JSON (explicit file type)');
    return parseJSON(content, transcriptId);
  }
  
  // Auto-detect VTT/SRT format
  if (isVTTFormat(content)) {
    console.log('Parsing as VTT/SRT (auto-detected)');
    return parseVTT(content, transcriptId);
  }
  
  // Default to plain text
  console.log('Parsing as plain text');
  return parsePlainText(content, transcriptId);
}

/**
 * Post-process segments to ensure quality
 */
function cleanSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter(seg => {
    const text = seg.text.trim();
    
    // Remove empty or very short meaningless segments
    if (!text || text.length < 2) return false;
    
    // Remove timestamp-only segments that slipped through (multiple patterns)
    if (VTT_TIMESTAMP_REGEX.test(text) || SRT_TIMESTAMP_REGEX.test(text)) {
      console.log(`Filtering out timestamp segment: "${text}"`);
      return false;
    }
    
    // Also catch any line containing --> (timestamp arrow)
    if (text.includes('-->')) {
      console.log(`Filtering out arrow timestamp segment: "${text}"`);
      return false;
    }
    
    // Remove pure number segments (cue numbers)
    if (CUE_NUMBER_REGEX.test(text)) {
      console.log(`Filtering out cue number segment: "${text}"`);
      return false;
    }
    
    // Remove segments that are just timestamps without arrows (e.g., "00:41:17,320")
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3}$/.test(text)) {
      console.log(`Filtering out standalone timestamp: "${text}"`);
      return false;
    }
    
    // Remove very short segments that are likely noise (< 5 chars and no letters)
    if (text.length < 5 && !/[a-zA-Z]/.test(text)) {
      console.log(`Filtering out short noise segment: "${text}"`);
      return false;
    }
    
    return true;
  }).map((seg, idx) => ({
    ...seg,
    segmentId: `seg_${idx}`, // Re-index after filtering
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      transcript, 
      title, 
      date, 
      duration, 
      group, 
      project, 
      keywords, 
      topic,
      fileType = 'txt',
      state = 'uploaded_raw'
    } = await req.json();

    const searchEndpoint = Deno.env.get('AZURE_SEARCH_ENDPOINT');
    const searchApiKey = Deno.env.get('AZURE_SEARCH_API_KEY');
    const indexName = Deno.env.get('AZURE_SEARCH_INDEX_NAME');

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error('Azure Search credentials not configured');
    }

    if (!openaiConfigured()) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // FR1.3 - Generate transcript ID
    const transcriptId = `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('Processing transcript:', transcriptId);

    // FR1.3 - Parse and segment the transcript
    console.log('Step 1: Parsing transcript with format:', fileType);
    let segments = parseTranscript(transcript || '', fileType, transcriptId);
    
    // Post-process to clean up any noise
    segments = cleanSegments(segments);
    console.log(`Parsed and cleaned ${segments.length} segments`);

    if (segments.length === 0) {
      throw new Error('No valid segments extracted from transcript');
    }

    // Step 2: Generate embeddings for segments
    console.log('Step 2: Generating embeddings...');
    const segmentTexts = segments.map(s => s.text);
    const embeddedSegments: EmbeddedSegment[] = [];
    
    const batchSize = 16;
    for (let i = 0; i < segmentTexts.length; i += batchSize) {
      const batch = segmentTexts.slice(i, i + batchSize);
      console.log(`Embedding batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(segmentTexts.length / batchSize)}`);
      
      const embeddings = await embedTexts(batch);
      
      for (let j = 0; j < batch.length; j++) {
        embeddedSegments.push({
          ...segments[i + j],
          embedding: embeddings[j],
        });
      }
    }
    console.log(`Generated ${embeddedSegments.length} embeddings`);

    // Step 3: Upload transcript metadata document to Azure AI Search
    console.log('Step 3: Uploading transcript metadata document...');
    const azureUrl = `${searchEndpoint}/indexes/${indexName}/docs/index?api-version=2023-11-01`;
    
    // FR4.2 - Transcript-level document with metadata
    const metadataDocument = {
      value: [{
        "@search.action": "upload",
        id: transcriptId,
        docType: "metadata",
        transcriptId: transcriptId,
        transcript: transcript || '',
        title: title || 'Untitled Transcript',
        meetingTitle: title || 'Untitled Transcript',
        meetingDate: date || new Date().toISOString(),
        date: date || new Date().toISOString(),
        duration: duration || 0,
        group: group || '',
        project: project || '',
        keywords: keywords || '',
        topic: topic || '',
        topics: topic ? [topic] : [],
        tags: [],
        state: state,
        segmentCount: segments.length,
        hasTimestamps: segments.some(s => s.startTime),
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
      console.error('Azure Search error (metadata):', errorText);
      throw new Error(`Azure Search error: ${metadataResponse.status} - ${errorText}`);
    }

    // Step 4: Upload segment documents with embeddings
    console.log('Step 4: Uploading segment documents with embeddings...');
    const segmentDocuments = embeddedSegments.map(segment => ({
      "@search.action": "upload",
      id: `${transcriptId}_${segment.segmentId}`,
      docType: "segment",
      transcriptId: transcriptId,
      segmentId: segment.segmentId,
      transcript: segment.text,
      text: segment.text,
      startTime: segment.startTime || '',
      endTime: segment.endTime || '',
      speaker: segment.speaker || '',
      title: title || 'Untitled Transcript',
      meetingTitle: title || 'Untitled Transcript',
      meetingDate: date || new Date().toISOString(),
      date: date || new Date().toISOString(),
      duration: duration || 0,
      group: group || '',
      project: project || '',
      keywords: keywords || '',
      topic: topic || '',
      topics: topic ? [topic] : [],
      tags: [],
      embedding: segment.embedding,
    }));

    // Upload segments in batches
    const segmentBatchSize = 100;
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
        console.error('Azure Search error (segments):', errorText);
      }
    }

    console.log('Upload complete:', {
      transcriptId,
      segmentCount: embeddedSegments.length,
      state,
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        transcriptId,
        segmentCount: embeddedSegments.length,
        state,
        hasTimestamps: segments.some(s => s.startTime),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcripts-upload:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

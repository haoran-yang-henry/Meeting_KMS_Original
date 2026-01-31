// FR1.3 - Transcript parsing and segmentation utilities

import { TranscriptSegment, ParsedTranscript, FileClassification } from '@/types/transcription';

// VTT timestamp regex: 00:00:00.000 --> 00:00:00.000
const VTT_TIMESTAMP_REGEX = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/;
// SRT timestamp: 00:00:00,000 --> 00:00:00,000
const SRT_TIMESTAMP_REGEX = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;
// Zoom/Teams format: [00:00:00] Speaker:
const BRACKET_TIMESTAMP_REGEX = /\[(\d{2}:\d{2}:\d{2})\]/;
// Speaker pattern
const SPEAKER_REGEX = /^([A-Za-z\s]+):\s*/;

/**
 * FR1.2 - Auto-classify file type as transcript or context
 */
export function classifyFile(content: string, fileName: string): FileClassification {
  const lowerContent = content.toLowerCase();
  const lowerName = fileName.toLowerCase();
  
  // Check file extension hints
  if (lowerName.endsWith('.vtt') || lowerName.endsWith('.srt')) {
    return 'transcript';
  }
  
  // Check for timestamp patterns (indicates transcript)
  if (VTT_TIMESTAMP_REGEX.test(content) || 
      SRT_TIMESTAMP_REGEX.test(content) ||
      BRACKET_TIMESTAMP_REGEX.test(content)) {
    return 'transcript';
  }
  
  // Check for glossary/context indicators
  const contextIndicators = ['glossary', 'definition', 'terminology', 'acronym', 'abbreviation'];
  if (contextIndicators.some(term => lowerContent.includes(term) || lowerName.includes(term))) {
    return 'context';
  }
  
  // Default to transcript
  return 'transcript';
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
 * Check if text starts with continuation indicators (lowercase, conjunctions)
 */
function startsWithContinuation(text: string): boolean {
  const trimmed = text.trim();
  // Starts with lowercase letter or common conjunctions/continuations
  const continuationPatterns = /^(and|but|or|so|because|then|however|also|which|that|who|where|when|[a-z])/i;
  return /^[a-z]/.test(trimmed) || continuationPatterns.test(trimmed);
}

/**
 * FR1.3 - Parse VTT format with semantic merging
 * Strategy: 精简时间戳 + 语义合并
 * - Merges segments from same speaker that are part of same thought
 * - Uses punctuation, time proximity, and continuation patterns
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
    const line = lines[i].trim();
    
    // Skip WEBVTT header and empty lines
    if (line === 'WEBVTT' || line === '' || line.startsWith('NOTE')) {
      if (currentSegment && currentSegment.text) {
        rawSegments.push({ ...currentSegment, text: currentSegment.text.trim() });
        currentSegment = null;
      }
      continue;
    }
    
    // Check for timestamp line (VTT or SRT)
    const timestampMatch = line.match(VTT_TIMESTAMP_REGEX) || line.match(SRT_TIMESTAMP_REGEX);
    if (timestampMatch) {
      if (currentSegment && currentSegment.text) {
        rawSegments.push({ ...currentSegment, text: currentSegment.text.trim() });
      }
      currentSegment = {
        startTime: timestampMatch[1].replace(',', '.'),
        endTime: timestampMatch[2].replace(',', '.'),
        text: '',
      };
      continue;
    }
    
    // Skip cue identifiers (numeric lines before timestamps)
    if (/^\d+$/.test(line)) continue;
    
    // Text content
    if (currentSegment) {
      const speakerMatch = line.match(SPEAKER_REGEX);
      if (speakerMatch) {
        currentSegment.speaker = speakerMatch[1].trim();
        currentSegment.text = (currentSegment.text || '') + line.replace(SPEAKER_REGEX, '') + ' ';
      } else {
        currentSegment.text = (currentSegment.text || '') + line + ' ';
      }
    }
  }
  
  // Don't forget the last segment
  if (currentSegment && currentSegment.text) {
    rawSegments.push({ ...currentSegment, text: currentSegment.text.trim() });
  }
  
  if (rawSegments.length === 0) return [];

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
    
    // Calculate time gap
    const prevEnd = timestampToSeconds(prev.endTime);
    const currStart = timestampToSeconds(curr.startTime);
    const timeGap = currStart - prevEnd;
    
    // Get current buffer length and combined length
    const currentBufferLength = mergeBuffer.reduce((sum, s) => sum + s.text.length, 0);
    const combinedLength = currentBufferLength + curr.text.length;
    
    // Decide whether to merge based on semantic rules
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
      // Flush merge buffer as a single segment
      const firstSeg = mergeBuffer[0];
      const lastSeg = mergeBuffer[mergeBuffer.length - 1];
      const mergedText = mergeBuffer.map(s => s.text).join(' ');
      
      mergedSegments.push({
        segmentId: `seg_${mergedSegments.length}`,
        transcriptId,
        text: mergedText.trim(),
        startTime: firstSeg.startTime, // 精简时间戳: use first segment's start
        endTime: lastSeg.endTime,       // and last segment's end
        speaker: firstSeg.speaker,
      });
      
      // Start new buffer with current segment
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
  
  return mergedSegments;
}

/**
 * FR1.3 - Parse plain text with optional timestamps
 */
function parsePlainText(content: string, transcriptId: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = content.split('\n').filter(l => l.trim());
  
  let segmentIndex = 0;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    // Check for bracket timestamp format [00:00:00]
    const bracketMatch = trimmedLine.match(BRACKET_TIMESTAMP_REGEX);
    let text = trimmedLine;
    let startTime: string | undefined;
    let speaker: string | undefined;
    
    if (bracketMatch) {
      startTime = bracketMatch[1];
      text = trimmedLine.replace(BRACKET_TIMESTAMP_REGEX, '').trim();
    }
    
    // Check for speaker
    const speakerMatch = text.match(SPEAKER_REGEX);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = text.replace(SPEAKER_REGEX, '').trim();
    }
    
    if (text) {
      segments.push({
        segmentId: `seg_${segmentIndex}`,
        transcriptId,
        text,
        startTime,
        speaker,
      });
      segmentIndex++;
    }
  }
  
  // If no lines were detected, split by paragraphs
  if (segments.length === 0) {
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim());
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
    
    // Handle array of segments
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
    
    // Handle object with segments array
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
    
    // Handle object with transcript field
    if (data.transcript) {
      return parsePlainText(data.transcript, transcriptId);
    }
    
    // Fallback: stringify the object
    return [{
      segmentId: 'seg_0',
      transcriptId,
      text: JSON.stringify(data, null, 2),
    }];
  } catch {
    // If JSON parsing fails, treat as plain text
    return parsePlainText(content, transcriptId);
  }
}

/**
 * FR1.3 - Main parsing function
 */
export function parseTranscript(
  content: string, 
  fileName: string,
  transcriptId: string = `transcript_${Date.now()}`
): ParsedTranscript {
  const classification = classifyFile(content, fileName);
  const ext = fileName.toLowerCase().split('.').pop() || '';
  
  let segments: TranscriptSegment[] = [];
  let detectedFormat = 'text';
  let hasTimestamps = false;
  
  switch (ext) {
    case 'vtt':
    case 'srt':
      segments = parseVTT(content, transcriptId);
      detectedFormat = 'vtt';
      hasTimestamps = segments.some(s => s.startTime);
      break;
      
    case 'json':
      segments = parseJSON(content, transcriptId);
      detectedFormat = 'json';
      hasTimestamps = segments.some(s => s.startTime);
      break;
      
    case 'txt':
    case 'md':
    default:
      // Detect VTT/SRT even when extension is wrong (e.g. .txt converted from .srt)
      if (
        content.includes('WEBVTT') ||
        content.includes('-->') ||
        VTT_TIMESTAMP_REGEX.test(content) ||
        SRT_TIMESTAMP_REGEX.test(content)
      ) {
        segments = parseVTT(content, transcriptId);
        detectedFormat = 'vtt';
      } else {
        segments = parsePlainText(content, transcriptId);
        detectedFormat = 'text';
      }
      hasTimestamps = segments.some(s => s.startTime);
      break;
  }
  
  return {
    segments,
    rawText: content,
    classification,
    hasTimestamps,
    detectedFormat,
  };
}

/**
 * Convert segments back to plain text
 */
export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments.map(seg => {
    let line = '';
    if (seg.startTime) {
      line += `[${seg.startTime}] `;
    }
    if (seg.speaker) {
      line += `${seg.speaker}: `;
    }
    line += seg.text;
    return line;
  }).join('\n');
}

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { 
  CorrectionSuggestion, 
  CheckTranscriptRequest, 
  CheckTranscriptResponse,
  CorrectedSegment 
} from '@/types/correction';
import { TranscriptSegment } from '@/types/transcription';
import { useToast } from '@/hooks/use-toast';

export function useTranscriptCheck() {
  const [suggestions, setSuggestions] = useState<CorrectionSuggestion[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [correctedSegments, setCorrectedSegments] = useState<Map<string, CorrectedSegment>>(new Map());
  const { toast } = useToast();

  const checkTranscript = useCallback(async (
    transcriptId: string,
    segments: TranscriptSegment[],
    context?: {
      additionalContext?: string;
      glossary?: string;
      projectContext?: string;
    }
  ) => {
    setIsChecking(true);
    setSuggestions([]);
    
    try {
      // Client-side batching - 30 segments per request to avoid payload size issues
      const batchSize = 30;
      const segmentsToCheck = segments.map(seg => ({
        segmentId: seg.segmentId,
        transcriptId: seg.transcriptId,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
        speaker: seg.speaker,
      }));
      
      const totalBatches = Math.ceil(segmentsToCheck.length / batchSize);
      console.log(`Checking ${segmentsToCheck.length} segments in ${totalBatches} client-side batches`);
      
      const allSuggestions: CorrectionSuggestion[] = [];
      
      // Process batches in parallel
      const batchPromises: Promise<any>[] = [];
      for (let i = 0; i < segmentsToCheck.length; i += batchSize) {
        const batch = segmentsToCheck.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`Queuing batch ${batchNum}/${totalBatches}`);
        
        batchPromises.push(
          supabase.functions.invoke('transcripts-check', {
            body: {
              transcriptId,
              segments: batch,
              ...context,
            } as CheckTranscriptRequest,
          })
        );
      }
      
      const results = await Promise.all(batchPromises);

      let batchErrorCount = 0;
      let firstBatchErrorMessage: string | null = null;

      // Aggregate suggestions from all batches
      for (const result of results) {
        if (result.error) {
          batchErrorCount += 1;
          if (!firstBatchErrorMessage) {
            firstBatchErrorMessage = result.error.message || 'One or more batches failed';
          }
          console.error('Batch error:', result.error);
          continue;
        }
        const response = result.data as CheckTranscriptResponse;
        if (response.success && response.suggestions) {
          allSuggestions.push(...response.suggestions);
        }
      }

      // Sort by priority (context first) and confidence
      allSuggestions.sort((a, b) => {
        if (a.priority === 'context' && b.priority !== 'context') return -1;
        if (a.priority !== 'context' && b.priority === 'context') return 1;
        return (b.confidence || 0) - (a.confidence || 0);
      });

      // Show all suggestions (no limit)
      setSuggestions(allSuggestions);

      if (allSuggestions.length > 0) {
        toast({
          title: 'Check complete',
          description: `Found ${allSuggestions.length} suggestion${allSuggestions.length > 1 ? 's' : ''} for improvement.`,
        });
      } else if (batchErrorCount > 0) {
        toast({
          title: 'Check failed',
          description: firstBatchErrorMessage || 'AI did not return a usable result. Please try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Check complete',
          description: 'No issues found in the transcript.',
        });
      }

      
      return {
        success: true,
        suggestions: allSuggestions,
        totalSegmentsChecked: segments.length,
      } as CheckTranscriptResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check transcript';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setIsChecking(false);
    }
  }, [toast]);

  const applySuggestion = useCallback((suggestion: CorrectionSuggestion) => {
    setSuggestions(prev => prev.filter(s => s.suggestionId !== suggestion.suggestionId));
    
    setCorrectedSegments(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(suggestion.segmentId);
      
      if (existing) {
        // Apply the correction to already corrected text
        const updatedText = existing.correctedText.replace(
          suggestion.originalText,
          suggestion.suggestedText
        );
        newMap.set(suggestion.segmentId, {
          ...existing,
          correctedText: updatedText,
          appliedSuggestions: [...existing.appliedSuggestions, suggestion.suggestionId],
        });
      } else {
        // First correction for this segment - need original text from somewhere
        newMap.set(suggestion.segmentId, {
          segmentId: suggestion.segmentId,
          originalText: suggestion.originalText,
          correctedText: suggestion.suggestedText,
          appliedSuggestions: [suggestion.suggestionId],
        });
      }
      
      return newMap;
    });
    
    toast({
      title: 'Correction applied',
      description: `Replaced "${suggestion.originalText}" with "${suggestion.suggestedText}"`,
    });
  }, [toast]);

  const keepAsIs = useCallback((suggestion: CorrectionSuggestion) => {
    setSuggestions(prev => prev.filter(s => s.suggestionId !== suggestion.suggestionId));
    
    toast({
      title: 'Kept original',
      description: `Kept "${suggestion.originalText}" as is.`,
    });
  }, [toast]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setCorrectedSegments(new Map());
  }, []);

  return {
    suggestions,
    isChecking,
    correctedSegments,
    checkTranscript,
    applySuggestion,
    keepAsIs,
    clearSuggestions,
  };
}

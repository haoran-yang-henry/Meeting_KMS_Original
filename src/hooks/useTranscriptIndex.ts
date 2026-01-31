import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { TranscriptSegment } from '@/types/transcription';

interface IndexMetadata {
  meetingTitle: string;
  meetingDate?: string;
  project?: string;
  group?: string;
  tags?: string[];
  topics?: string[];
}

interface IndexResult {
  success: boolean;
  transcriptId: string;
  segmentsIndexed: number;
  totalSegments: number;
  state: string;
  isCorrected: boolean;
}

export function useTranscriptIndex() {
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const { toast } = useToast();

  /**
   * FR3 - Add transcript to index with embeddings
   * @param transcriptId - Unique identifier for the transcript
   * @param segments - Array of segments (corrected or raw)
   * @param metadata - Transcript metadata
   * @param isCorrected - Whether using corrected version
   */
  const addToIndex = async (
    transcriptId: string,
    segments: TranscriptSegment[],
    metadata: IndexMetadata,
    isCorrected: boolean = false
  ): Promise<IndexResult | null> => {
    setIsIndexing(true);
    setIndexResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('transcripts-add-to-index', {
        body: {
          transcriptId,
          segments: segments.map(s => ({
            segmentId: s.segmentId,
            transcriptId: s.transcriptId,
            text: s.text,
            startTime: s.startTime,
            endTime: s.endTime,
            speaker: s.speaker,
          })),
          metadata,
          isCorrected,
        },
      });

      if (error) throw error;

      const result = data as IndexResult;
      setIndexResult(result);

      toast({
        title: 'Indexing Complete',
        description: `${result.segmentsIndexed} segments indexed successfully.`,
      });

      return result;
    } catch (err) {
      console.error('Index error:', err);
      toast({
        variant: 'destructive',
        title: 'Indexing Failed',
        description: err instanceof Error ? err.message : 'Failed to add transcript to index.',
      });
      return null;
    } finally {
      setIsIndexing(false);
    }
  };

  const clearResult = () => {
    setIndexResult(null);
  };

  return {
    isIndexing,
    indexResult,
    addToIndex,
    clearResult,
  };
}

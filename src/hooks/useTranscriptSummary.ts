import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// FR5.1 - Generated summary structure
export interface TranscriptSummary {
  summaryText: string;
  decisions: string[];
  actionItems: string[];
  topicTags: string[];
}

interface GenerateSummaryOptions {
  includeDecisions?: boolean;
  includeActionItems?: boolean;
  includeTopicTags?: boolean;
  transcriptContent?: string;
}

export function useTranscriptSummary() {
  const [summary, setSummary] = useState<TranscriptSummary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const { toast } = useToast();

  /**
   * FR5.1 - Generate summary from transcript
   */
  const generateSummary = useCallback(async (
    transcriptId: string,
    options?: GenerateSummaryOptions
  ): Promise<TranscriptSummary | null> => {
    if (!transcriptId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No transcript selected.',
      });
      return null;
    }

    setIsGenerating(true);
    setSavedAt(null);

    try {
      const { data, error } = await supabase.functions.invoke('transcripts-generate-summary', {
        body: {
          transcriptId,
          transcriptContent: options?.transcriptContent,
          includeDecisions: options?.includeDecisions ?? true,
          includeActionItems: options?.includeActionItems ?? true,
          includeTopicTags: options?.includeTopicTags ?? true,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate summary');
      }

      const generatedSummary: TranscriptSummary = {
        summaryText: data.summaryText,
        decisions: data.decisions || [],
        actionItems: data.actionItems || [],
        topicTags: data.topicTags || [],
      };

      setSummary(generatedSummary);

      toast({
        title: 'Summary Generated',
        description: 'Review and edit the summary before saving.',
      });

      return generatedSummary;

    } catch (err) {
      console.error('Generate summary error:', err);
      toast({
        variant: 'destructive',
        title: 'Generation Failed',
        description: err instanceof Error ? err.message : 'Failed to generate summary.',
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  /**
   * FR5.2 - Update summary locally (before saving)
   */
  const updateSummary = useCallback((updates: Partial<TranscriptSummary>) => {
    setSummary(prev => prev ? { ...prev, ...updates } : null);
    setSavedAt(null); // Mark as unsaved
  }, []);

  /**
   * FR5.3 - Save validated summary to Azure AI Search
   */
  const saveSummary = useCallback(async (
    transcriptId: string,
    summaryToSave?: TranscriptSummary
  ): Promise<boolean> => {
    const finalSummary = summaryToSave || summary;
    
    if (!transcriptId || !finalSummary) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No summary to save.',
      });
      return false;
    }

    setIsSaving(true);

    try {
      // Combine all tags
      const allTags = [
        ...finalSummary.topicTags,
        ...finalSummary.decisions.map(d => `decision: ${d.slice(0, 50)}`),
        ...finalSummary.actionItems.map(a => `action: ${a.slice(0, 50)}`),
      ];

      // Build full summary text
      let fullSummaryText = finalSummary.summaryText;
      
      if (finalSummary.decisions.length > 0) {
        fullSummaryText += '\n\n## Decisions\n' + finalSummary.decisions.map(d => `- ${d}`).join('\n');
      }
      
      if (finalSummary.actionItems.length > 0) {
        fullSummaryText += '\n\n## Action Items\n' + finalSummary.actionItems.map(a => `- ${a}`).join('\n');
      }

      const { data, error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId,
          summaryText: fullSummaryText,
          summaryTags: finalSummary.topicTags,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to save summary');
      }

      setSavedAt(new Date(data.summaryUpdatedAt));

      toast({
        title: 'Summary Saved',
        description: 'Your validated summary has been saved.',
      });

      return true;

    } catch (err) {
      console.error('Save summary error:', err);
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: err instanceof Error ? err.message : 'Failed to save summary.',
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [summary, toast]);

  /**
   * Clear current summary
   */
  const clearSummary = useCallback(() => {
    setSummary(null);
    setSavedAt(null);
  }, []);

  /**
   * FR5.4 - Get summary text for use as context in chats
   */
  const getSummaryContext = useCallback((): string | undefined => {
    if (!summary) return undefined;
    
    let context = summary.summaryText;
    
    if (summary.decisions.length > 0) {
      context += '\n\nKey Decisions: ' + summary.decisions.join('; ');
    }
    
    if (summary.actionItems.length > 0) {
      context += '\n\nAction Items: ' + summary.actionItems.join('; ');
    }
    
    return context;
  }, [summary]);

  return {
    summary,
    isGenerating,
    isSaving,
    savedAt,
    generateSummary,
    updateSummary,
    saveSummary,
    clearSummary,
    getSummaryContext,
  };
}

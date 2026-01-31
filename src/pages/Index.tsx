import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/Sidebar";
import { CorrectionSuggestions } from "@/components/CorrectionSuggestions";
import { AISummary } from "@/components/AISummary";
import { MeetingAssistantChat } from "@/components/MeetingAssistantChat";
import { useTranscriptWorkflow, GeneratedSummary } from "@/hooks/useTranscriptWorkflow";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { t } = useTranslation();
  const [totalSuggestions, setTotalSuggestions] = useState(0);
  const [isAdjustingSummary, setIsAdjustingSummary] = useState(false);
  const [editedSummaryText, setEditedSummaryText] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [correctionsOpen, setCorrectionsOpen] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  
  // Track if we've already shown the initial summary in chat
  const hasShownInitialSummaryRef = useRef(false);
  // Track the last summary text we showed to avoid duplicates
  const lastShownSummaryRef = useRef<string | null>(null);
  // Store the ORIGINAL summary for iterative adjustments (prevents compounding cuts)
  const originalSummaryRef = useRef<string | null>(null);
  
  const {
    transcript,
    suggestions,
    summary,
    isChecking,
    isUploading,
    isGeneratingSummary,
    isSavingTranscript,
    isIndexed,
    correctedSegments,
    systemMessages,
    metadata,
    usedProjectMemory,
    uploadTranscript,
    applySuggestion,
    keepAsIs,
    saveTranscript,
    saveSummary,
    getSummaryContext,
    updateSummary,
    recheckWithContext,
    regenerateSummary,
    clearTranscript,
    addSystemMessage,
    clearSystemMessages,
    updateMetadata,
    updateMeetingName,
  } = useTranscriptWorkflow();

  // Update total suggestions when checking completes
  useEffect(() => {
    if (!isChecking && suggestions.length > 0 && totalSuggestions === 0) {
      setTotalSuggestions(suggestions.length);
    }
  }, [isChecking, suggestions.length, totalSuggestions]);

  // Reset total when new transcript is uploaded
  useEffect(() => {
    if (isUploading) {
      setTotalSuggestions(0);
      hasShownInitialSummaryRef.current = false;
      lastShownSummaryRef.current = null;
      originalSummaryRef.current = null; // Reset original summary for new transcript
    }
  }, [isUploading]);

  // Show summary in chat when it's first generated (after upload workflow)
  // IMPORTANT: Avoid duplicates across re-renders AND across page navigations (Index unmount/mount)
  // Also: Do NOT trigger for summary adjustments (which already add 'summary-adjusted' messages)
  useEffect(() => {
    // Skip if already shown or currently generating
    if (hasShownInitialSummaryRef.current || isGeneratingSummary) return;
    // Skip if no summary or no transcript
    if (!summary?.summaryText || !transcript) return;

    // If this exact summary was already logged as a system message (persisted), don't add again
    const alreadyInChat = systemMessages.some(
      (m) => (m.type === 'summary-generated' || m.type === 'summary-adjusted') && m.summaryText === summary.summaryText
    );
    if (alreadyInChat) {
      hasShownInitialSummaryRef.current = true;
      lastShownSummaryRef.current = summary.summaryText;
      originalSummaryRef.current = summary.summaryText;
      return;
    }

    // Skip if we've already shown this exact summary text (prevents duplicates on re-renders)
    if (lastShownSummaryRef.current === summary.summaryText) return;

    hasShownInitialSummaryRef.current = true;
    lastShownSummaryRef.current = summary.summaryText;
    // Store the original summary for future adjustments
    originalSummaryRef.current = summary.summaryText;
    addSystemMessage({
      type: 'summary-generated',
      content: t('chat.summaryGenerated'),
      summaryText: summary.summaryText,
    });
  }, [summary?.summaryText, isGeneratingSummary, addSystemMessage, t, transcript, systemMessages]);

  const handleRecheckWithContext = (context: string) => {
    setTotalSuggestions(0);
    recheckWithContext(context);
  };

  const handleAdjustSummary = useCallback(async (prompt: string): Promise<string> => {
    const currentSummary = editedSummaryText || summary?.summaryText;
    if (!currentSummary) return "";
    if (!transcript?.content) return "";

    setIsAdjustingSummary(true);
    
    // Add user message for display
    addSystemMessage({
      type: 'user-summary',
      content: prompt,
    });
    
    try {
      // Let AI routing determine the tool (adjust_summary, extract_from_transcript, etc.)
      const { data, error } = await supabase.functions.invoke('transcripts-chat', {
        body: {
          query: prompt,
          summaryContext: currentSummary,
          originalSummary: originalSummaryRef.current || currentSummary,
          transcriptContent: transcript.content,
          conversationHistory: [],
        },
      });

      if (error) throw error;

      const responseText = data?.answer || '';
      const toolUsed = data?.toolUsed;
      
      // Only add chat message and auto-save if the AI routed to adjust_summary tool
      // NOTE: Do NOT update the AISummary panel - adjustments only show in chat
      if (toolUsed === 'adjust_summary') {
        
        // Auto-save personal summary to Azure Search
        if (transcript?.id) {
          try {
            await supabase.functions.invoke('transcripts-save-summary', {
              body: {
                transcriptId: transcript.id,
                personalSummary: responseText.trim(),  // Save to personalSummary field
              },
            });
            console.log('Personal summary auto-saved to Azure Search');
          } catch (saveError) {
            console.error('Failed to auto-save personal summary:', saveError);
          }
        }
        
        addSystemMessage({
          type: 'summary-adjusted',
          content: t('chat.summaryAdjusted'),
          summaryText: responseText.trim(),
          agentIntent: {
            tool: toolUsed,
            confidence: data?.toolConfidence || 0.8,
            reasoning: data?.toolReasoning || 'Summary adjustment',
          },
        });
      } else {
        // For search/extract tools, show answer as chat response without updating summary
        addSystemMessage({
          type: 'assistant-summary',
          content: responseText.trim(),
          agentIntent: toolUsed ? {
            tool: toolUsed,
            confidence: data?.toolConfidence || 0.8,
            reasoning: data?.toolReasoning || 'Query processed',
          } : undefined,
        });
      }

      return responseText.trim();
    } catch (err) {
      console.error('Chat error:', err);
      return "";
    } finally {
      setIsAdjustingSummary(false);
    }
  }, [editedSummaryText, summary, transcript, updateSummary, addSystemMessage, t]);

  // Track if regeneration is in progress to show regenerated summary in chat
  const wasRegeneratingRef = useRef(false);

  // Watch for regeneration completion and show in chat
  useEffect(() => {
    if (isGeneratingSummary) {
      wasRegeneratingRef.current = true;
    } else if (wasRegeneratingRef.current && summary?.summaryText) {
      // Regeneration just completed
      wasRegeneratingRef.current = false;
      
      // Check if this summary was already shown as adjusted (to avoid duplicate messages)
      const alreadyAdjusted = systemMessages.some(
        (m) => m.type === 'summary-adjusted' && m.summaryText === summary.summaryText
      );
      
      if (hasShownInitialSummaryRef.current && lastShownSummaryRef.current !== summary.summaryText && !alreadyAdjusted) {
        // This is a regeneration (not initial generation or adjustment), show it in chat
        lastShownSummaryRef.current = summary.summaryText;
        // Reset original summary to the new regenerated version
        originalSummaryRef.current = summary.summaryText;
        addSystemMessage({
          type: 'summary-generated',
          content: t('chat.summaryGenerated'),
          summaryText: summary.summaryText,
        });
      }
    }
  }, [isGeneratingSummary, summary?.summaryText, addSystemMessage, t, systemMessages]);

  const handleClearSession = () => {
    clearTranscript();
    setTotalSuggestions(0);
    setEditedSummaryText("");
    setAdditionalContext("");
    clearSystemMessages();
    hasShownInitialSummaryRef.current = false;
    lastShownSummaryRef.current = null;
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden p-4">
        {/* Two Column Layout: Chat (expanded) | Right sidebar (Corrections + Summary) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
          <div className="lg:col-span-2 h-full min-h-0">
            <MeetingAssistantChat 
              onTranscriptUpload={uploadTranscript}
              isUploading={isUploading}
              isChecking={isChecking}
              isGeneratingSummary={isGeneratingSummary}
              isSavingTranscript={isSavingTranscript}
              summaryContext={getSummaryContext()}
              currentSummary={summary}
              onSummaryUpdate={updateSummary}
              isAdjustingSummary={isAdjustingSummary}
              onAdjustingSummaryChange={setIsAdjustingSummary}
              editedSummaryText={editedSummaryText}
              transcriptId={transcript?.id}
              isIndexed={isIndexed}
              systemMessages={systemMessages}
              onAddSystemMessage={addSystemMessage}
              onClearSystemMessages={clearSystemMessages}
              additionalContext={additionalContext}
              onAdditionalContextChange={setAdditionalContext}
              hasSuggestions={suggestions.length > 0}
              transcriptContent={transcript?.content}
              onProjectChange={(project) => updateMetadata({ project })}
              hasTranscript={!!transcript}
            />
          </div>
          <div className="flex flex-col gap-2 h-full min-h-0 overflow-hidden">
            {/* Clear Session Button - always visible */}
            <div className="flex justify-end px-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleClearSession}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs gap-1"
              >
                <Trash2 className="h-3 w-3" />
                {t('addPage.clearSession')}
              </Button>
            </div>
            
            {/* Correction Suggestions & Summary Panels */}
            <div className="flex-1 min-h-0 overflow-auto space-y-2">
              {/* Correction Suggestions Panel */}
              <CorrectionSuggestions
                suggestions={suggestions}
                isChecking={isChecking}
                onApply={applySuggestion}
                onKeepAsIs={keepAsIs}
                onSaveTranscript={saveTranscript}
                onRecheckWithContext={handleRecheckWithContext}
                totalSuggestions={totalSuggestions || suggestions.length}
                transcriptSegments={transcript?.segments}
                correctedSegments={correctedSegments}
                hasTranscript={!!transcript}
                additionalContext={additionalContext}
                onContextChange={setAdditionalContext}
                usedProjectMemory={usedProjectMemory}
              />

              {/* Summary Panel */}
              <AISummary 
                meetingName={transcript?.meetingName}
                summary={summary}
                isGenerating={isGeneratingSummary}
                isSavingTranscript={isSavingTranscript}
                onSummaryTextChange={setEditedSummaryText}
                onSaveSummary={saveSummary}
                onRegenerateSummary={regenerateSummary}
                metadata={{ project: metadata.project, topic: metadata.topic }}
                onMetadataChange={updateMetadata}
                onMeetingNameChange={updateMeetingName}
                onAdjustSummary={handleAdjustSummary}
                isAdjustingSummary={isAdjustingSummary}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;

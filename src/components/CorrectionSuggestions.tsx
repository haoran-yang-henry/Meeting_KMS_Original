import { useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, CheckCircle2, FileText, RefreshCw, Brain, ChevronUp, ChevronDown } from "lucide-react";
import { CorrectionSuggestion } from "@/types/correction";

interface TranscriptSegment {
  segmentId: string;
  text: string;
  startTime?: string;
  endTime?: string;
}

interface CorrectionSuggestionsProps {
  suggestions: CorrectionSuggestion[];
  isChecking: boolean;
  onApply: (suggestion: CorrectionSuggestion) => void;
  onKeepAsIs: (suggestion: CorrectionSuggestion) => void;
  onSaveTranscript: () => void;
  onRecheckWithContext?: (context: string) => void;
  totalSuggestions?: number;
  transcriptContent?: string;
  transcriptSegments?: TranscriptSegment[];
  correctedSegments?: Map<string, string>;
  hasTranscript?: boolean;
  additionalContext?: string;
  onContextChange?: (context: string) => void;
  usedProjectMemory?: boolean;
}

export const CorrectionSuggestions = ({
  suggestions,
  isChecking,
  onApply,
  onKeepAsIs,
  onSaveTranscript,
  onRecheckWithContext,
  totalSuggestions = 0,
  transcriptSegments = [],
  correctedSegments = new Map(),
  hasTranscript = false,
  additionalContext = "",
  onContextChange,
  usedProjectMemory = false,
}: CorrectionSuggestionsProps) => {
  const { t } = useTranslation();
  const suggestionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const remainingSuggestions = suggestions.length;
  const reviewedCount = totalSuggestions - remainingSuggestions;
  const isReadyToSave = hasTranscript && !isChecking && remainingSuggestions === 0;

  const handleKeepAsIs = (suggestion: CorrectionSuggestion, index: number) => {
    onKeepAsIs(suggestion);

    if (index < suggestions.length - 1) {
      setTimeout(() => {
        suggestionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  const handleApply = (suggestion: CorrectionSuggestion, index: number) => {
    onApply(suggestion);

    if (index < suggestions.length - 1) {
      setTimeout(() => {
        suggestionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  const handleApplyAllAndSave = useCallback(async () => {
    if (suggestions.length === 0) {
      onSaveTranscript();
      return;
    }

    setIsApplyingAll(true);
    
    // Capture all suggestions at the start (important: array will shrink as we apply)
    const allSuggestions = [...suggestions];
    
    // Apply each suggestion sequentially with visual feedback
    for (let i = 0; i < allSuggestions.length; i++) {
      const suggestion = allSuggestions[i];
      
      // Scroll to the first visible suggestion (always index 0 after previous removals)
      suggestionRefs.current[0]?.scrollIntoView({ behavior: "smooth", block: "start" });
      
      // Wait for scroll animation
      await new Promise(resolve => setTimeout(resolve, 300));
      onApply(suggestion);
      
      // Wait for visual effect before next
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    setIsApplyingAll(false);
    
    // Save after all applied
    setTimeout(() => {
      onSaveTranscript();
    }, 300);
  }, [suggestions, onApply, onSaveTranscript]);

  const handleRecheck = () => {
    if (onRecheckWithContext) {
      onRecheckWithContext(additionalContext);
    }
  };

  return (
    <Card className={`flex flex-col overflow-hidden ${isCollapsed ? '' : 'h-[450px]'}`}>
      <CardHeader className="py-3 px-4 shrink-0 border-b cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('corrections.title')}</CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
      <CardContent className="flex-1 p-4 pt-3 flex flex-col overflow-auto min-h-0">
        <Tabs defaultValue="ai" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-2 h-9 shrink-0 mb-3">
            <TabsTrigger value="ai" className="text-xs">
              {t('corrections.suggestions')}
            </TabsTrigger>
            <TabsTrigger value="context" className="text-xs">
              {t('corrections.context')}
            </TabsTrigger>
          </TabsList>

          {/* AI Suggestions Tab */}
          <TabsContent value="ai" className="flex-1 mt-0 min-h-0 flex flex-col overflow-hidden">
            
            {/* Project Memory Indicator */}
            {usedProjectMemory && !isChecking && (
              <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400 px-2 py-1.5 rounded-md mb-2 shrink-0">
                <Brain className="h-3.5 w-3.5" />
                <span>{t('corrections.usingProjectMemory', 'Using project memory for context')}</span>
              </div>
            )}
            
            {/* Status indicator */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              {isChecking ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('corrections.analyzing')}
                </div>
              ) : isReadyToSave ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('corrections.readyToSave')}
                </div>
              ) : hasTranscript ? (
                <p className="text-sm text-muted-foreground">
                  {remainingSuggestions > 0
                    ? `${remainingSuggestions} ${t('corrections.suggestionsToReview')}`
                    : t('corrections.allReviewed')}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('corrections.uploadFirst')}</p>
              )}
              {totalSuggestions > 0 && !isChecking && (
                <Badge variant="secondary" className="text-xs">
                  {reviewedCount}/{totalSuggestions} {t('corrections.done')}
                </Badge>
              )}
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="pr-3">
                {isChecking ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <p className="text-sm text-center">{t('corrections.checking')}</p>
                  </div>
                ) : !hasTranscript || suggestions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                    {!hasTranscript ? (
                      <>
                        <FileText className="h-10 w-10 opacity-50" />
                        <p className="text-sm text-center">{t('corrections.noTranscript')}</p>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                        <p className="text-sm text-center">
                          {totalSuggestions > 0 ? t('corrections.allReviewedDone') : t('corrections.noCorrectionsNeeded')}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((suggestion, index) => (
                      <div
                        key={suggestion.suggestionId}
                        ref={(el) => (suggestionRefs.current[index] = el)}
                        className="border rounded-md p-2 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {t(`issueTypes.${suggestion.issueType}`, suggestion.issueType)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {Math.round(suggestion.confidence * 100)}%
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{t('corrections.original')}</p>
                          <p className="text-sm line-through text-muted-foreground">"{suggestion.originalText}"</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">{t('corrections.suggested')}</p>
                          <p className="text-sm text-primary">"{suggestion.suggestedText}"</p>
                        </div>
                        {suggestion.reasoning && (
                          <p className="text-xs text-muted-foreground italic">{suggestion.reasoning}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            onClick={() => handleKeepAsIs(suggestion, index)}
                          >
                            {t('corrections.keepAsIs')}
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            onClick={() => handleApply(suggestion, index)}
                          >
                            {t('common.apply')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Add Context Tab */}
          <TabsContent value="context" className="flex-1 mt-0 min-h-0 flex flex-col overflow-hidden">
            <div className="flex flex-col h-full min-h-0">
              <Textarea
                placeholder={t('corrections.contextPlaceholder')}
                value={additionalContext}
                onChange={(e) => onContextChange?.(e.target.value)}
                className="flex-1 min-h-[80px] text-sm resize-none"
              />
              {hasTranscript && onRecheckWithContext && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 w-full shrink-0"
                  onClick={handleRecheck}
                  disabled={isChecking}
                >
                  {isChecking ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('corrections.rechecking')}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('corrections.recheckWithContext')}
                    </>
                  )}
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="pt-4 border-t mt-4 shrink-0">
          <Button
            size="default"
            className={`w-full ${isReadyToSave ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
            onClick={handleApplyAllAndSave}
            disabled={!hasTranscript || isChecking || isApplyingAll}
          >
            {!hasTranscript
              ? t('corrections.uploadTranscriptFirst')
              : isChecking
                ? t('corrections.analyzing')
                : isApplyingAll
                  ? t('corrections.applyingAll')
                  : t('corrections.applyAllAndSave')}
          </Button>
        </div>
      </CardContent>
      )}
    </Card>
  );
};

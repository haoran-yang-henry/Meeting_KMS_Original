import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X, Loader2, Save, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import { GeneratedSummary } from "@/hooks/useTranscriptWorkflow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface AISummaryProps {
  meetingName?: string;
  summary?: GeneratedSummary | null;
  isGenerating?: boolean;
  isSavingTranscript?: boolean;
  onSummaryTextChange?: (text: string) => void;
  onSaveSummary?: (summaryText: string, keywords: string[], project: string, topic: string) => Promise<boolean>;
  onRegenerateSummary?: () => Promise<void>;
  metadata?: { project?: string; topic?: string };
  onMetadataChange?: (metadata: { project?: string; topic?: string }) => void;
  onMeetingNameChange?: (name: string) => void;
  onAdjustSummary?: (prompt: string) => Promise<string>;
  isAdjustingSummary?: boolean;
}

export const AISummary = ({ meetingName, summary, isGenerating = false, isSavingTranscript = false, onSummaryTextChange, onSaveSummary, onRegenerateSummary, metadata, onMetadataChange, onMeetingNameChange, onAdjustSummary, isAdjustingSummary = false }: AISummaryProps) => {
  const { t } = useTranslation();
  const [keywords, setKeywords] = useState<string[]>(summary?.topicTags || []);
  const [newKeyword, setNewKeyword] = useState("");
  const [isAddingKeyword, setIsAddingKeyword] = useState(false);
  const [editedSummary, setEditedSummary] = useState(summary?.summaryText || "");
  const [isSaving, setIsSaving] = useState(false);
  const [selectedProject, setSelectedProject] = useState(metadata?.project || "");
  const [userTopic, setUserTopic] = useState(metadata?.topic || "");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Reset local state when summary changes (including when cleared to null)
  useEffect(() => {
    setKeywords(summary?.topicTags || []);
  }, [summary]);

  useEffect(() => {
    setEditedSummary(summary?.summaryText || "");
  }, [summary]);

  // Reset metadata when it changes or clears
  useEffect(() => {
    setSelectedProject(metadata?.project || "");
    setUserTopic(metadata?.topic || "");
  }, [metadata?.project, metadata?.topic, metadata]);

  const handleProjectChange = (value: string) => {
    setSelectedProject(value);
    onMetadataChange?.({ project: value });
  };

  const handleTopicChange = (value: string) => {
    setUserTopic(value);
    onMetadataChange?.({ topic: value });
  };

  const handleSummaryChange = (value: string) => {
    setEditedSummary(value);
    onSummaryTextChange?.(value);
  };

  const handleAddKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword("");
      setIsAddingKeyword(false);
    }
  };

  const handleRemoveKeyword = (keywordToRemove: string) => {
    setKeywords(keywords.filter(kw => kw !== keywordToRemove));
  };

  const executeSave = async () => {
    if (!onSaveSummary || !editedSummary) return;
    setIsSaving(true);
    try {
      await onSaveSummary(editedSummary, keywords, selectedProject, userTopic);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!onSaveSummary || !editedSummary) return;
    
    if (!selectedProject.trim() || !userTopic.trim()) {
      setShowConfirmDialog(true);
      return;
    }
    
    await executeSave();
  };

  const handleConfirmSaveWithoutMetadata = async () => {
    setShowConfirmDialog(false);
    await executeSave();
  };

  const handleApplyFormat = async (prompt: string) => {
    if (!onAdjustSummary) return;
    const newSummary = await onAdjustSummary(prompt);
    if (newSummary) {
      setEditedSummary(newSummary);
      onSummaryTextChange?.(newSummary);
    }
  };

  return (
    <Card className={`flex flex-col overflow-hidden ${isCollapsed ? '' : 'h-[450px]'}`}>
      <CardHeader className="py-2 px-3 shrink-0 cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('summary.title')}</CardTitle>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
      <CardContent className="flex-1 flex flex-col overflow-auto p-3 pt-0 min-h-0">
        {/* Keywords section - fixed height */}
        <div className="space-y-1 shrink-0 pb-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">{t('summary.keywords')}</label>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setIsAddingKeyword(true)}
              disabled={!meetingName}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            {keywords.map((keyword) => (
              <Badge key={keyword} variant="secondary" className="text-xs pr-1 flex items-center gap-1">
                {keyword}
                <button
                  onClick={() => handleRemoveKeyword(keyword)}
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {keywords.length === 0 && !isAddingKeyword && (
              <span className="text-xs text-muted-foreground italic">{t('summary.noKeywords')}</span>
            )}
            {isAddingKeyword && (
              <div className="flex items-center gap-1">
                <Input
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleAddKeyword()}
                  placeholder={t('summary.newKeyword')}
                  className="h-6 w-20 text-xs"
                  autoFocus
                />
                <Button size="sm" className="h-6 px-2 text-xs" onClick={handleAddKeyword}>
                  {t('common.add')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setIsAddingKeyword(false);
                    setNewKeyword("");
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Summary Content - flexible height */}
        <div className="flex-1 flex flex-col min-h-0 pt-2 border-t overflow-hidden">
          <p className="text-xs font-medium text-muted-foreground shrink-0 mb-1">{t('summary.generatedSummary')}</p>
          {isGenerating || isAdjustingSummary ? (
            <div className="bg-muted/50 rounded-md p-3 flex items-center gap-2 shrink-0">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {isAdjustingSummary ? t('summaryFormats.applying') : t('summary.regenerating')}
              </span>
            </div>
          ) : meetingName ? (
            <Textarea
              value={editedSummary}
              onChange={(e) => handleSummaryChange(e.target.value)}
              placeholder={t('summary.summaryPlaceholder')}
              className="flex-1 min-h-0 resize-none text-sm bg-muted/50"
            />
          ) : (
            <div className="bg-muted/50 rounded-md p-2 shrink-0">
              <p className="text-sm text-muted-foreground italic">
                {t('summary.uploadToGenerate')}
              </p>
            </div>
          )}
          {meetingName && (
            <p className="text-xs text-muted-foreground shrink-0 mt-1">{t('summary.editHint')}</p>
          )}

          {/* Action Buttons */}
          {meetingName && (
            <div className="flex gap-2 mt-2 shrink-0">
              {onRegenerateSummary && (
                <Button
                  onClick={onRegenerateSummary}
                  disabled={isGenerating || isAdjustingSummary}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('summary.regenerating')}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('summary.regenerate')}
                    </>
                  )}
                </Button>
              )}
              {editedSummary && (
                <Button
                  onClick={handleSaveSummary}
                  disabled={isSaving || isGenerating || isSavingTranscript || isAdjustingSummary}
                  size="sm"
                  className="flex-1"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('summary.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {t('summary.saveSummary')}
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
      )}

      {/* Confirmation Dialog for saving without project/topic */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('summary.saveWithoutCategorization')}</AlertDialogTitle>
            <AlertDialogDescription>
              {!selectedProject.trim() && !userTopic.trim() 
                ? t('summary.noProjectOrTopic')
                : !selectedProject.trim()
                  ? t('summary.noProject')
                  : t('summary.noTopic')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.goBack')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSaveWithoutMetadata}>
              {t('common.saveAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

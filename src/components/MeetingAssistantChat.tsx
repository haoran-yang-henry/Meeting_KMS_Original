import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Send, FileText, FolderOpen, Video, Loader2, Trash2, Upload, CheckCircle, Inbox, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranscriptChat, ChatMessage } from "@/hooks/useTranscriptChat";
import { GeneratedSummary, WorkflowSystemMessage, AgentIntent } from "@/hooks/useTranscriptWorkflow";
import type { AgentToolName } from "@/types/agent";
import { supabase } from "@/integrations/supabase/client";
import { WorkflowStatusIndicator } from "@/components/WorkflowStatusIndicator";
import { useWorkflowSteps } from "@/hooks/useWorkflowSteps";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ThinkingProcess } from "@/components/ThinkingProcess";
import { useSidebarCategories } from "@/hooks/useSidebarCategories";
import { EmptyStateUpload } from "@/components/EmptyStateUpload";

interface MeetingAssistantChatProps {
  onTranscriptUpload?: (file: File, additionalContext?: string, customMeetingName?: string) => Promise<boolean>;
  isUploading?: boolean;
  isChecking?: boolean;
  isGeneratingSummary?: boolean;
  isSavingTranscript?: boolean;
  summaryContext?: string;
  currentSummary?: GeneratedSummary | null;
  onSummaryUpdate?: (summary: GeneratedSummary) => void;
  isAdjustingSummary?: boolean;
  onAdjustingSummaryChange?: (isAdjusting: boolean) => void;
  editedSummaryText?: string;
  transcriptId?: string;
  isIndexed?: boolean;
  systemMessages?: WorkflowSystemMessage[];
  onAddSystemMessage?: (message: Omit<WorkflowSystemMessage, 'id' | 'timestamp'>) => void;
  onClearSystemMessages?: () => void;
  additionalContext?: string;
  onAdditionalContextChange?: (context: string) => void;
  hasSuggestions?: boolean;
  transcriptContent?: string; // Full transcript content for accurate summary adjustments
  onProjectChange?: (project: string) => void;
  hasTranscript?: boolean; // Whether a transcript has been uploaded
}

// REMOVED: Legacy keyword matching - now using AI intent routing exclusively

export const MeetingAssistantChat = ({ 
  onTranscriptUpload,
  isUploading = false,
  isChecking = false,
  isGeneratingSummary = false,
  isSavingTranscript = false,
  summaryContext,
  currentSummary,
  onSummaryUpdate,
  isAdjustingSummary = false,
  onAdjustingSummaryChange,
  editedSummaryText,
  transcriptId,
  isIndexed = false,
  systemMessages = [],
  onAddSystemMessage,
  onClearSystemMessages,
  additionalContext = "",
  onAdditionalContextChange,
  hasSuggestions = false,
  transcriptContent,
  onProjectChange,
  hasTranscript = false,
}: MeetingAssistantChatProps) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isTeamsDialogOpen, setIsTeamsDialogOpen] = useState(false);
  const [teamsApiEndpoint, setTeamsApiEndpoint] = useState("");
  const [teamsAccessToken, setTeamsAccessToken] = useState("");
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [dialogStep, setDialogStep] = useState<1 | 2 | 3>(1); // Step 1: Meeting name, Step 2: Project, Step 3: Context
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedProject, setSelectedProject] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [meetingName, setMeetingName] = useState("");
  const [dialogContext, setDialogContext] = useState(""); // Context provided in dialog step 3
  const [isProcessingSummaryRequest, setIsProcessingSummaryRequest] = useState(false);
  const [pendingAgentIntent, setPendingAgentIntent] = useState<AgentIntent | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Use the transcript chat hook for AI responses
  const { messages, isLoading, sendMessage, clearHistory } = useTranscriptChat();
  
  // Get existing projects from sidebar
  const { categories, addProject } = useSidebarCategories();

  // Generate workflow steps for the status indicator
  const workflowSteps = useWorkflowSteps({
    isUploading,
    isChecking,
    isGeneratingSummary,
    isSavingTranscript,
    hasTranscript: !!transcriptId,
    hasSuggestions,
    hasSummary: !!currentSummary?.summaryText,
    isIndexed,
  });

  // Combine system messages with chat messages for display
  const allMessages = [
    ...systemMessages.map(m => ({ ...m, role: 'system' as const })),
    ...messages,
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages, isLoading, isUploading, isAdjustingSummary, isProcessingSummaryRequest]);

  // Send message with summary context - AI routing determines the tool
  const sendWithSummaryContext = async (userRequest: string): Promise<string> => {
    // Use edited text from panel if available, otherwise fall back to current summary
    const summaryToUse = editedSummaryText || currentSummary?.summaryText;
    if (!summaryToUse) return "No summary available.";
    if (!transcriptContent) return "Transcript content is required for accurate responses.";

    // Build conversation history from all messages for context
    const conversationHistory = allMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6) // Last 6 messages for context
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    try {
      const { data, error } = await supabase.functions.invoke('transcripts-chat', {
        body: {
          query: userRequest,
          summaryContext: summaryToUse,
          transcriptContent: transcriptContent,
          conversationHistory,
          transcriptId: isIndexed ? transcriptId : undefined,
          // REMOVED: adjustSummary flag - let AI routing decide the tool
        },
      });

      if (error) throw error;

      const responseText = data?.answer || '';
      
      // Extract agent intent from response
      const toolUsed = data?.toolUsed as AgentToolName;
      const agentIntent: AgentIntent | undefined = toolUsed ? {
        tool: toolUsed,
        confidence: data.toolConfidence || 0.8,
        reasoning: data.toolReasoning || 'Query processed',
      } : undefined;
      
      // Show thinking process for 1 second before displaying content
      if (agentIntent) {
        setPendingAgentIntent(agentIntent);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // For adjust_summary tool: only show in chat + auto-save to personalSummary
      // NOTE: Do NOT update the AISummary panel (group summary) - adjustments only appear in chat
      if (toolUsed === 'adjust_summary') {

        // Auto-save personal summary to Azure Search
        if (transcriptId && isIndexed) {
          try {
            await supabase.functions.invoke('transcripts-save-summary', {
              body: {
                transcriptId: transcriptId,
                personalSummary: responseText.trim(),
              },
            });
            console.log('Personal summary auto-saved to Azure Search');
          } catch (saveError) {
            console.error('Failed to auto-save personal summary:', saveError);
          }
        }

        // Add summary-adjusted message with agent intent
        onAddSystemMessage?.({
          type: 'summary-adjusted',
          content: t('chat.summaryAdjusted'),
          summaryText: responseText.trim(),
          agentIntent,
        });
      } else {
        // For search_transcript, search_summary, extract_from_transcript - show answer without updating summary
        onAddSystemMessage?.({
          type: 'assistant-summary',
          content: responseText.trim(),
          agentIntent,
        });
      }

      setPendingAgentIntent(null);
      return responseText.trim();
    } catch (err) {
      console.error('Chat error:', err);
      setPendingAgentIntent(null);
      return "Sorry, I couldn't process your request. Please try again.";
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || isAdjustingSummary || isProcessingSummaryRequest) return;
    
    const query = inputValue;
    setInputValue("");
    
    // If summary exists, send with summary context - AI routing decides the tool
    const hasSummary = editedSummaryText || currentSummary?.summaryText;
    if (hasSummary) {
      // Add user message for display
      onAddSystemMessage?.({
        type: 'user-summary',
        content: query,
      });

      setIsProcessingSummaryRequest(true);
      try {
        await sendWithSummaryContext(query);
      } finally {
        setIsProcessingSummaryRequest(false);
      }
    } else {
      // No summary - regular chat message
      const transcriptForChat = isIndexed ? transcriptId : undefined;
      await sendMessage(query, transcriptForChat, { summaryContext });
    }
  };

  const handleUpload = async (type: "transcript" | "context") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = type === "context" ? ".txt,.md,.json" : ".txt,.md,.docx,.json,.vtt,.srt,.pdf";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (type === "context") {
        // Add upload confirmation message
        onAddSystemMessage?.({
          type: 'upload',
          content: `${t('chat.contextReceived')}: ${file.name}`,
          fileName: file.name,
        });
        
        try {
          const text = (await file.text()).trim();
          const merged = [additionalContext.trim(), text].filter(Boolean).join("\n\n");
          onAdditionalContextChange?.(merged);

          onAddSystemMessage?.({
            type: 'system',
            content: 'Context added. Go to the Corrections panel and click "Recheck with context".',
          });
        } catch (err) {
          console.error('Context file read error:', err);
          onAddSystemMessage?.({
            type: 'system',
            content: 'Could not read that context file. Please upload a .txt/.md file.',
          });
        }
        return;
      }

      // For transcript upload, show project selection dialog first
      setPendingFile(file);
      // Set default meeting name from file name (without extension)
      const defaultMeetingName = file.name.replace(/\.[^/.]+$/, '');
      setMeetingName(defaultMeetingName);
      setShowProjectDialog(true);
    };

    input.click();
    setIsPopoverOpen(false);
  };

  const handleProjectConfirm = async () => {
    if (!pendingFile || !onTranscriptUpload) return;
    
    // Determine the project to use
    let projectToUse = selectedProject;
    if (newProjectName.trim()) {
      projectToUse = newProjectName.trim();
      addProject(projectToUse); // Add to sidebar
    }
    
    // If no project selected and no new project, use "unassigned"
    if (!projectToUse) {
      projectToUse = "unassigned";
    }
    
    // Set project before upload
    onProjectChange?.(projectToUse);
    
    // Merge dialog context with any existing additional context
    const contextToUse = dialogContext.trim() 
      ? [additionalContext.trim(), dialogContext.trim()].filter(Boolean).join("\n\n")
      : additionalContext;
    
    // Update the additional context state so it appears in the Context tab
    if (dialogContext.trim()) {
      onAdditionalContextChange?.(contextToUse);
    }
    
    // Add upload confirmation message
    onAddSystemMessage?.({
      type: 'upload',
      content: `${t('chat.transcriptReceived')}: ${pendingFile.name}`,
      fileName: pendingFile.name,
    });
    
    // Add project assignment message
    onAddSystemMessage?.({
      type: 'system',
      content: projectToUse === 'unassigned' 
        ? t('chat.assignedToUnassigned')
        : `${t('chat.assignedToProject')}: ${projectToUse}`,
    });
    
    // Add context provided message if context was entered
    if (dialogContext.trim()) {
      onAddSystemMessage?.({
        type: 'system',
        content: t('chat.contextProvided'),
      });
    }
    
    setShowProjectDialog(false);
    
    // Process the transcript upload with the context
    const success = await onTranscriptUpload(pendingFile, contextToUse || undefined, meetingName.trim() || undefined);

    if (success) {
      onAddSystemMessage?.({
        type: 'system',
        content: t('chat.reviewSuggestions'),
      });
    }
    
    // Reset state
    setPendingFile(null);
    setSelectedProject("");
    setNewProjectName("");
    setMeetingName("");
    setDialogContext("");
  };

  const handleProjectDialogCancel = () => {
    setShowProjectDialog(false);
    setDialogStep(1);
    setPendingFile(null);
    setSelectedProject("");
    setNewProjectName("");
    setMeetingName("");
    setDialogContext("");
  };

  const handleNextStep = () => {
    if (dialogStep === 1 && meetingName.trim()) {
      setDialogStep(2);
    } else if (dialogStep === 2) {
      setDialogStep(3);
    }
  };

  const handleBackStep = () => {
    if (dialogStep === 3) {
      setDialogStep(2);
    } else if (dialogStep === 2) {
      setDialogStep(1);
    }
  };

  const handleTeamsConnect = () => {
    setIsPopoverOpen(false);
    setIsTeamsDialogOpen(true);
  };

  const handleTeamsSubmit = () => {
    if (teamsApiEndpoint.trim() || teamsAccessToken.trim()) {
      console.log('Connected to Microsoft Teams');
      setTeamsApiEndpoint("");
      setTeamsAccessToken("");
      setIsTeamsDialogOpen(false);
    }
  };

  const handleClearAll = () => {
    onClearSystemMessages?.();
    clearHistory();
  };

  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader className="py-3 px-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{t('chat.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('chat.subtitle')}
            </p>
          </div>
          {allMessages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClearAll}
              title={t('chat.clearHistory')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden p-3 pt-0 min-h-0">
        {/* Show EmptyStateUpload when no transcript and no messages */}
        {!hasTranscript && allMessages.length === 0 && !isUploading ? (
          <EmptyStateUpload onUploadTranscript={() => handleUpload("transcript")} />
        ) : (
          <>
            {/* Messages Area */}
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-3 py-2">
                {allMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
            
            {/* Workflow Status Indicator - shows multi-step progress */}
            {workflowSteps.length > 0 && (
              <WorkflowStatusIndicator 
                steps={workflowSteps}
                isVisible={isUploading || isChecking || isGeneratingSummary || isSavingTranscript}
              />
            )}
            
            {/* Chat loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 max-w-[85%]">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{isIndexed ? t('chat.searchingTranscript') : t('chat.thinking')}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Summary-context request loading indicator - shows thinking process */}
            {isProcessingSummaryRequest && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 max-w-[85%] animate-fade-in">
                  {pendingAgentIntent ? (
                    // Tool selected - show the actual thinking process
                    <div className="space-y-2">
                      <ThinkingProcess 
                        tool={pendingAgentIntent.tool}
                        reasoning={pendingAgentIntent.reasoning}
                        confidence={pendingAgentIntent.confidence}
                        isExpanded={true}
                      />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t('chat.generatingResponse')}</span>
                      </div>
                    </div>
                  ) : (
                    // Still routing - show analyzing state
                    <>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />
                        <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">{t('chat.analyzing')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t('chat.routingQuery')}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            
            {/* Summary adjustment loading indicator (from summary panel actions) */}
            {isAdjustingSummary && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 max-w-[85%]">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{t('chat.thinking')}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="space-y-2 pt-3 border-t mt-3 shrink-0">
          {/* Prompt suggestions - show when summary exists */}
          {(currentSummary?.summaryText || editedSummaryText) && (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {[
                { label: t('promptSuggestions.purpose'), prompt: 'Generate a concise executive summary focusing exclusively on Purpose' },
                { label: t('promptSuggestions.keyDecisions'), prompt: 'Generate a concise executive summary focusing exclusively on Key Decisions' },
                { label: t('promptSuggestions.discussionPoints'), prompt: 'Generate a concise executive summary focusing exclusively on Discussion Points' },
                { label: t('promptSuggestions.actionItems'), prompt: 'Generate a concise executive summary focusing exclusively on Action Items' },
                { label: t('promptSuggestions.openQuestions'), prompt: 'Generate a concise executive summary focusing exclusively on Open Questions' },
                { label: t('promptSuggestions.topicTags'), prompt: 'Generate a concise executive summary focusing exclusively on Topic Tags' },
              ].map((suggestion) => (
                <Button
                  key={suggestion.label}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 bg-background hover:bg-accent"
                  onClick={() => {
                    setInputValue(suggestion.prompt);
                  }}
                  disabled={isLoading || isUploading || isAdjustingSummary}
                >
                  {suggestion.label}
                </Button>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 items-center">
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0 h-9 w-9">
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <div className="space-y-1">
                  <p className="text-sm font-medium px-2 py-1 text-muted-foreground">{t('chat.addToChat')}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-9 text-sm"
                    onClick={() => handleUpload("transcript")}
                    disabled={isUploading}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {t('chat.uploadTranscript')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-9 text-sm"
                    onClick={() => handleUpload("context")}
                    disabled={isUploading}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {t('chat.uploadContext')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-9 text-sm"
                    onClick={handleTeamsConnect}
                  >
                    <Video className="mr-2 h-4 w-4" />
                    {t('chat.msTeams')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Input
              placeholder={t('chat.placeholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSend()}
              disabled={isLoading || isUploading || isAdjustingSummary || isProcessingSummaryRequest}
              className="flex-1 h-9 text-sm"
            />
            <Button 
              size="icon" 
              onClick={handleSend} 
              disabled={!inputValue.trim() || isLoading || isUploading || isAdjustingSummary || isProcessingSummaryRequest}
              className="shrink-0 h-9 w-9"
            >
              {isLoading || isAdjustingSummary ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
          </>
        )}
      </CardContent>

      {/* Microsoft Teams Dialog */}
      <Dialog open={isTeamsDialogOpen} onOpenChange={setIsTeamsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('teamsDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('teamsDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-endpoint">{t('teamsDialog.apiEndpoint')}</Label>
              <Input
                id="api-endpoint"
                placeholder={t('teamsDialog.apiPlaceholder')}
                value={teamsApiEndpoint}
                onChange={(e) => setTeamsApiEndpoint(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="access-token">{t('teamsDialog.accessToken')}</Label>
              <Textarea
                id="access-token"
                placeholder={t('teamsDialog.tokenPlaceholder')}
                value={teamsAccessToken}
                onChange={(e) => setTeamsAccessToken(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTeamsDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleTeamsSubmit} disabled={!teamsApiEndpoint.trim() && !teamsAccessToken.trim()}>
              {t('common.connect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Selection Dialog - 2 Steps */}
      <Dialog open={showProjectDialog} onOpenChange={(open) => {
        if (!open) handleProjectDialogCancel();
        else setShowProjectDialog(open);
      }}>
        <DialogContent className="sm:max-w-md">
          {/* Step 1: Meeting Name */}
          {dialogStep === 1 && (
            <>
              <DialogHeader>
                <DialogTitle>{t('chat.meetingName')}</DialogTitle>
                <DialogDescription>
                  {t('chat.meetingNameHelp')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{t('chat.meetingName')}</Label>
                  <Input
                    placeholder={t('chat.meetingNamePlaceholder')}
                    value={meetingName}
                    onChange={(e) => setMeetingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && meetingName.trim()) {
                        handleNextStep();
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleProjectDialogCancel}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleNextStep} disabled={!meetingName.trim()}>
                  {t('common.next')}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 2: Project Assignment */}
          {dialogStep === 2 && (
            <>
              <DialogHeader>
                <DialogTitle>{t('chat.selectProject')}</DialogTitle>
                <DialogDescription>
                  {t('chat.selectProjectDescription')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* Existing Projects */}
                {categories.projects.length > 0 && (
                  <div className="space-y-2">
                    <Label>{t('chat.existingProjects')}</Label>
                    <div className="grid gap-2 max-h-[200px] overflow-y-auto">
                      {categories.projects.map((project) => (
                        <Button
                          key={project}
                          variant={selectedProject === project ? "default" : "outline"}
                          className="justify-start h-auto py-2"
                          onClick={() => {
                            setSelectedProject(project);
                            setNewProjectName("");
                          }}
                        >
                          <FolderOpen className="h-4 w-4 mr-2" />
                          {project}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Unassigned option */}
                <Button
                  variant={selectedProject === "" && newProjectName === "" ? "secondary" : "outline"}
                  className="w-full justify-start h-auto py-2"
                  onClick={() => {
                    setSelectedProject("");
                    setNewProjectName("");
                  }}
                >
                  <Inbox className="h-4 w-4 mr-2" />
                  {t('chat.unassignedMeetings')}
                </Button>
                
                {/* Create new project */}
                <div className="space-y-2">
                  <Label>{t('chat.orCreateNew')}</Label>
                  <Input
                    placeholder={t('chat.newProjectPlaceholder')}
                    value={newProjectName}
                    onChange={(e) => {
                      setNewProjectName(e.target.value);
                      setSelectedProject("");
                    }}
                  />
                </div>
              </div>
              <DialogFooter className="flex justify-between sm:justify-between">
                <Button variant="outline" onClick={handleBackStep}>
                  {t('common.back')}
                </Button>
                <Button onClick={handleNextStep}>
                  {t('common.next')}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Step 3: Meeting Context */}
          {dialogStep === 3 && (
            <>
              <DialogHeader>
                <DialogTitle>{t('chat.provideMeetingContext')}</DialogTitle>
                <DialogDescription>
                  {t('chat.provideMeetingContextDescription')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{t('chat.meetingContextLabel')}</Label>
                  <Textarea
                    placeholder={t('chat.meetingContextPlaceholder')}
                    value={dialogContext}
                    onChange={(e) => setDialogContext(e.target.value)}
                    className="min-h-[120px] resize-none !border-0 !border-l-4 !border-l-primary !rounded-none bg-muted/30 focus-visible:!ring-0 focus-visible:!ring-offset-0"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('chat.meetingContextHelp')}
                </p>
              </div>
              <DialogFooter className="flex justify-between sm:justify-between">
                <Button variant="outline" onClick={handleBackStep}>
                  {t('common.back')}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleProjectConfirm}>
                    {t('chat.skipContext')}
                  </Button>
                  <Button onClick={handleProjectConfirm}>
                    {t('chat.uploadWithContext')}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// Message bubble component
const MessageBubble = ({ message }: { message: any }) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user' || message.type === 'user-summary';
  
  if (message.type === 'upload') {
    return (
      <div className="flex justify-end">
        <div className="bg-emerald-500/90 text-white rounded-lg px-4 py-2.5 max-w-[85%] flex items-center gap-2">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'system') {
    return (
      <div className="flex justify-start">
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 rounded-lg px-4 py-2.5 max-w-[85%]">
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  // Summary adjustment messages
  if (message.type === 'user-summary') {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2.5 max-w-[85%]">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === 'assistant-summary') {
    return (
      <div className="flex justify-start">
        <div className="bg-muted rounded-lg px-4 py-2.5 max-w-[85%]">
          {/* Show thinking process visualization */}
          {message.agentIntent && (
            <div className="mb-3">
              <ThinkingProcess 
                tool={message.agentIntent.tool}
                reasoning={message.agentIntent.reasoning}
                confidence={message.agentIntent.confidence}
              />
            </div>
          )}
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    );
  }

  // Summary generated message - show summary content
  if (message.type === 'summary-generated') {
    return (
      <div className="flex justify-start">
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg px-4 py-3 max-w-[85%]">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">{t('chat.summaryGenerated')}</span>
          </div>
          {message.summaryText && (
            <p className="text-sm whitespace-pre-wrap text-foreground/90">{message.summaryText}</p>
          )}
        </div>
      </div>
    );
  }

  // Summary adjusted message - show new summary content with agent intent
  if (message.type === 'summary-adjusted') {
    return (
      <div className="flex justify-start">
        <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/20 rounded-lg px-4 py-3 max-w-[85%]">
          {/* Show thinking process visualization */}
          {message.agentIntent && (
            <div className="mb-3">
              <ThinkingProcess 
                tool={message.agentIntent.tool}
                reasoning={message.agentIntent.reasoning}
                confidence={message.agentIntent.confidence}
              />
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{t('chat.summaryAdjusted')}</span>
          </div>
          {message.summaryText && (
            <MarkdownRenderer content={message.summaryText} />
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-lg px-4 py-2.5 max-w-[85%] ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {/* Show thinking process visualization */}
            {message.agentIntent && (
              <div className="mb-3">
                <ThinkingProcess 
                  tool={message.agentIntent.tool}
                  reasoning={message.agentIntent.reasoning}
                  confidence={message.agentIntent.confidence}
                />
              </div>
            )}
            <MarkdownRenderer content={message.content} />
          </>
        )}
        {!isUser && message.segmentsUsed !== undefined && message.segmentsUsed > 0 && (
          <p className="text-xs mt-1.5 opacity-60">
            {t('common.basedOn')} {message.segmentsUsed} {t('common.segments')}
          </p>
        )}
      </div>
    </div>
  );
};

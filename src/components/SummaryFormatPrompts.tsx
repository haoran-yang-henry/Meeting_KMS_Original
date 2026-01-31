import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Loader2, Wand2, Edit2, Check, Trash2 } from "lucide-react";

export interface SummaryPrompt {
  id: string;
  label: string;
  prompt: string;
  isCustom?: boolean;
}

interface SummaryFormatPromptsProps {
  onApplyPrompt: (prompt: string) => Promise<void>;
  isAdjusting: boolean;
  hasContent: boolean;
}

const DEFAULT_PROMPTS: SummaryPrompt[] = [
  {
    id: "purpose",
    label: "promptSuggestions.purpose",
    prompt: "Rewrite the summary to focus on the PURPOSE of this meeting: What was the main goal or objective? Why did this meeting take place? What problem was being addressed?",
  },
  {
    id: "keyDecisions",
    label: "promptSuggestions.keyDecisions",
    prompt: "Rewrite the summary as a list of KEY DECISIONS made in this meeting. Format as bullet points with clear, actionable decisions.",
  },
  {
    id: "discussionPoints",
    label: "promptSuggestions.discussionPoints",
    prompt: "Rewrite the summary to highlight DISCUSSION POINTS: Who were the key stakeholders? What strategies were discussed? What trade-offs were considered?",
  },
  {
    id: "actionItems",
    label: "promptSuggestions.actionItems",
    prompt: "Rewrite the summary as ACTION ITEMS / NEXT STEPS. Format as a clear list of tasks, who is responsible, and any deadlines mentioned.",
  },
  {
    id: "openQuestions",
    label: "promptSuggestions.openQuestions",
    prompt: "Rewrite the summary to list OPEN QUESTIONS that remain unresolved after this meeting. What needs further discussion or clarification?",
  },
  {
    id: "topicTags",
    label: "promptSuggestions.topicTags",
    prompt: "Generate 5-8 TOPIC TAGS that categorize the main themes and subjects discussed in this meeting.",
  },
];

export const SummaryFormatPrompts = ({
  onApplyPrompt,
  isAdjusting,
  hasContent,
}: SummaryFormatPromptsProps) => {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<SummaryPrompt[]>(DEFAULT_PROMPTS);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editedPromptText, setEditedPromptText] = useState("");
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);

  const handleSelectPrompt = (prompt: SummaryPrompt) => {
    setSelectedPromptId(prompt.id);
    setEditingPromptId(null);
  };

  const handleEditPrompt = (prompt: SummaryPrompt) => {
    setEditingPromptId(prompt.id);
    setEditedPromptText(prompt.prompt);
  };

  const handleSaveEdit = () => {
    if (!editingPromptId) return;
    setPrompts((prev) =>
      prev.map((p) =>
        p.id === editingPromptId ? { ...p, prompt: editedPromptText } : p
      )
    );
    setEditingPromptId(null);
    setEditedPromptText("");
  };

  const handleCancelEdit = () => {
    setEditingPromptId(null);
    setEditedPromptText("");
  };

  const handleDeletePrompt = (id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    if (selectedPromptId === id) {
      setSelectedPromptId(null);
    }
  };

  const handleAddCustomPrompt = () => {
    if (!newLabel.trim() || !newPrompt.trim()) return;
    const newId = `custom-${Date.now()}`;
    setPrompts((prev) => [
      ...prev,
      { id: newId, label: newLabel.trim(), prompt: newPrompt.trim(), isCustom: true },
    ]);
    setNewLabel("");
    setNewPrompt("");
    setIsAddingCustom(false);
  };

  const handleApply = async () => {
    if (!selectedPrompt) return;
    const promptText = editingPromptId === selectedPrompt.id ? editedPromptText : selectedPrompt.prompt;
    await onApplyPrompt(promptText);
  };

  return (
    <Tabs defaultValue="formats" className="flex-1 flex flex-col overflow-hidden">
      <TabsList className="grid w-full grid-cols-2 h-9 shrink-0 mb-3">
        <TabsTrigger value="formats" className="text-xs">
          {t('summaryFormats.formats')}
        </TabsTrigger>
        <TabsTrigger value="custom" className="text-xs">
          {t('summaryFormats.custom')}
        </TabsTrigger>
      </TabsList>

      {/* Formats Tab */}
      <TabsContent value="formats" className="flex-1 mt-0 min-h-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <p className="text-xs text-muted-foreground">
            {t('summaryFormats.selectFormat')}
          </p>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="pr-3 space-y-2">
            {/* Prompt Chips */}
            <div className="flex flex-wrap gap-1.5">
              {prompts.map((prompt) => (
                <Badge
                  key={prompt.id}
                  variant={selectedPromptId === prompt.id ? "default" : "outline"}
                  className={`cursor-pointer text-xs px-2 py-1 ${
                    selectedPromptId === prompt.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  } ${prompt.isCustom ? "border-dashed" : ""}`}
                  onClick={() => handleSelectPrompt(prompt)}
                >
                  {prompt.isCustom ? prompt.label : t(prompt.label)}
                  {prompt.isCustom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePrompt(prompt.id);
                      }}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))}
            </div>

            {/* Selected Prompt Details */}
            {selectedPrompt && (
              <div className="mt-3 p-3 border rounded-md bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {t('summaryFormats.promptPreview')}
                  </span>
                  {editingPromptId !== selectedPrompt.id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => handleEditPrompt(selectedPrompt)}
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      {t('common.edit')}
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={handleCancelEdit}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={handleSaveEdit}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {editingPromptId === selectedPrompt.id ? (
                  <Textarea
                    value={editedPromptText}
                    onChange={(e) => setEditedPromptText(e.target.value)}
                    className="text-sm min-h-[80px] resize-none"
                  />
                ) : (
                  <p className="text-sm text-foreground">{selectedPrompt.prompt}</p>
                )}

                <Button
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleApply}
                  disabled={isAdjusting || !hasContent}
                >
                  {isAdjusting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('summaryFormats.applying')}
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      {t('summaryFormats.applyFormat')}
                    </>
                  )}
                </Button>
              </div>
            )}

            {!selectedPrompt && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Wand2 className="h-8 w-8 opacity-50 mb-2" />
                <p className="text-sm text-center">{t('summaryFormats.selectToPreview')}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>

      {/* Custom Tab */}
      <TabsContent value="custom" className="flex-1 mt-0 min-h-0 flex flex-col overflow-hidden">
        <ScrollArea className="flex-1 min-h-0">
          <div className="pr-3 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('summaryFormats.customDescription')}
            </p>

            {isAddingCustom ? (
              <div className="space-y-2 p-3 border rounded-md bg-muted/30">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('summaryFormats.labelName')}
                  </label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t('summaryFormats.labelPlaceholder')}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('summaryFormats.promptText')}
                  </label>
                  <Textarea
                    value={newPrompt}
                    onChange={(e) => setNewPrompt(e.target.value)}
                    placeholder={t('summaryFormats.promptPlaceholder')}
                    className="text-sm min-h-[80px] resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setIsAddingCustom(false);
                      setNewLabel("");
                      setNewPrompt("");
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleAddCustomPrompt}
                    disabled={!newLabel.trim() || !newPrompt.trim()}
                  >
                    {t('common.add')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setIsAddingCustom(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('summaryFormats.addCustom')}
              </Button>
            )}

            {/* List of custom prompts */}
            {prompts.filter((p) => p.isCustom).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  {t('summaryFormats.yourCustomPrompts')}
                </p>
                {prompts
                  .filter((p) => p.isCustom)
                  .map((prompt) => (
                    <div
                      key={prompt.id}
                      className="p-2 border rounded-md bg-muted/20 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{prompt.label}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => handleDeletePrompt(prompt.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {prompt.prompt}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};

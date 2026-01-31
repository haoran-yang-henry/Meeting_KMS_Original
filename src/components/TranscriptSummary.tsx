// FR5 - Summary Generation & Storage component
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, 
  Sparkles, 
  Save, 
  Plus, 
  X, 
  CheckCircle,
  FileText,
  ListChecks,
  Target,
  Tags
} from "lucide-react";
import { useTranscriptSummary, TranscriptSummary } from "@/hooks/useTranscriptSummary";
import { Checkbox } from "@/components/ui/checkbox";

interface TranscriptSummaryProps {
  transcriptId?: string;
  isIndexed: boolean;
  meetingTitle?: string;
  transcriptContent?: string;
}

export const TranscriptSummaryComponent = ({
  transcriptId,
  isIndexed,
  meetingTitle,
  transcriptContent,
}: TranscriptSummaryProps) => {
  const {
    summary,
    isGenerating,
    isSaving,
    savedAt,
    generateSummary,
    updateSummary,
    saveSummary,
    clearSummary,
  } = useTranscriptSummary();

  // Generation options
  const [includeDecisions, setIncludeDecisions] = useState(true);
  const [includeActionItems, setIncludeActionItems] = useState(true);
  const [includeTopicTags, setIncludeTopicTags] = useState(true);

  // Edit mode state
  const [newDecision, setNewDecision] = useState("");
  const [newActionItem, setNewActionItem] = useState("");
  const [newTag, setNewTag] = useState("");

  const handleGenerate = async () => {
    if (!transcriptId) return;
    await generateSummary(transcriptId, {
      includeDecisions,
      includeActionItems,
      includeTopicTags,
      transcriptContent,
    });
  };

  const handleSave = async () => {
    if (!transcriptId || !summary) return;
    await saveSummary(transcriptId);
  };

  // FR5.2 - Edit handlers
  const handleAddDecision = () => {
    if (newDecision.trim() && summary) {
      updateSummary({ decisions: [...summary.decisions, newDecision.trim()] });
      setNewDecision("");
    }
  };

  const handleRemoveDecision = (index: number) => {
    if (summary) {
      updateSummary({ decisions: summary.decisions.filter((_, i) => i !== index) });
    }
  };

  const handleAddActionItem = () => {
    if (newActionItem.trim() && summary) {
      updateSummary({ actionItems: [...summary.actionItems, newActionItem.trim()] });
      setNewActionItem("");
    }
  };

  const handleRemoveActionItem = (index: number) => {
    if (summary) {
      updateSummary({ actionItems: summary.actionItems.filter((_, i) => i !== index) });
    }
  };

  const handleAddTag = () => {
    if (newTag.trim() && summary) {
      updateSummary({ topicTags: [...summary.topicTags, newTag.trim()] });
      setNewTag("");
    }
  };

  const handleRemoveTag = (index: number) => {
    if (summary) {
      updateSummary({ topicTags: summary.topicTags.filter((_, i) => i !== index) });
    }
  };

  // Precondition check
  if (!isIndexed || !transcriptId) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader className="py-3 px-4 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Meeting Summary
            </CardTitle>
            <Badge variant="outline" className="text-xs">FR5</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Index a transcript first to generate summaries.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader className="py-3 px-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Meeting Summary
            </CardTitle>
            {meetingTitle && (
              <p className="text-xs text-muted-foreground mt-1 truncate max-w-[180px]">
                {meetingTitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedAt && (
              <span className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Saved
              </span>
            )}
            <Badge variant="outline" className="text-xs">FR5</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col overflow-hidden p-3 pt-0 min-h-0">
        {!summary ? (
          // Generation options
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Generate an AI summary of the meeting transcript.
            </p>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="decisions" 
                  checked={includeDecisions}
                  onCheckedChange={(checked) => setIncludeDecisions(checked === true)}
                />
                <Label htmlFor="decisions" className="text-sm flex items-center gap-2">
                  <Target className="h-3.5 w-3.5" />
                  Include decisions
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="actions" 
                  checked={includeActionItems}
                  onCheckedChange={(checked) => setIncludeActionItems(checked === true)}
                />
                <Label htmlFor="actions" className="text-sm flex items-center gap-2">
                  <ListChecks className="h-3.5 w-3.5" />
                  Include action items
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="tags" 
                  checked={includeTopicTags}
                  onCheckedChange={(checked) => setIncludeTopicTags(checked === true)}
                />
                <Label htmlFor="tags" className="text-sm flex items-center gap-2">
                  <Tags className="h-3.5 w-3.5" />
                  Include topic tags
                </Label>
              </div>
            </div>

            <Button 
              onClick={handleGenerate} 
              disabled={isGenerating}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Summary
                </>
              )}
            </Button>
          </div>
        ) : (
          // FR5.2 - Summary editing view
          <ScrollArea className="flex-1">
            <div className="space-y-4 py-2 pr-2">
              {/* Summary text */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase">
                  Summary
                </Label>
                <Textarea
                  value={summary.summaryText}
                  onChange={(e) => updateSummary({ summaryText: e.target.value })}
                  className="min-h-[120px] text-sm"
                  placeholder="Meeting summary..."
                />
              </div>

              {/* Decisions */}
              {(summary.decisions.length > 0 || includeDecisions) && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-2">
                    <Target className="h-3.5 w-3.5" />
                    Decisions ({summary.decisions.length})
                  </Label>
                  <div className="space-y-1">
                    {summary.decisions.map((decision, idx) => (
                      <div key={idx} className="flex items-start gap-2 bg-muted/50 rounded p-2">
                        <span className="text-sm flex-1">{decision}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleRemoveDecision(idx)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        value={newDecision}
                        onChange={(e) => setNewDecision(e.target.value)}
                        placeholder="Add decision..."
                        className="h-8 text-sm"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddDecision()}
                      />
                      <Button size="sm" variant="outline" onClick={handleAddDecision} className="h-8">
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Items */}
              {(summary.actionItems.length > 0 || includeActionItems) && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-2">
                    <ListChecks className="h-3.5 w-3.5" />
                    Action Items ({summary.actionItems.length})
                  </Label>
                  <div className="space-y-1">
                    {summary.actionItems.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 bg-muted/50 rounded p-2">
                        <span className="text-sm flex-1">{item}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => handleRemoveActionItem(idx)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        value={newActionItem}
                        onChange={(e) => setNewActionItem(e.target.value)}
                        placeholder="Add action item..."
                        className="h-8 text-sm"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddActionItem()}
                      />
                      <Button size="sm" variant="outline" onClick={handleAddActionItem} className="h-8">
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Topic Tags */}
              {(summary.topicTags.length > 0 || includeTopicTags) && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-2">
                    <Tags className="h-3.5 w-3.5" />
                    Topic Tags
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.topicTags.map((tag, idx) => (
                      <Badge 
                        key={idx} 
                        variant="secondary" 
                        className="text-xs pr-1 flex items-center gap-1"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(idx)}
                          className="hover:bg-destructive/20 rounded-full p-0.5"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      placeholder="Add tag..."
                      className="h-8 text-sm"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                    />
                    <Button size="sm" variant="outline" onClick={handleAddTag} className="h-8">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Action buttons when summary exists */}
        {summary && (
          <div className="pt-3 border-t mt-2 shrink-0 space-y-2">
            <Button 
              onClick={handleSave} 
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Validated Summary
                </>
              )}
            </Button>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="flex-1 text-xs"
              >
                <Sparkles className="mr-1.5 h-3 w-3" />
                Regenerate
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={clearSummary}
                className="text-xs"
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

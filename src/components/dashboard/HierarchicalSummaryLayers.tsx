import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Save, Pencil, Trash2 } from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { TranscriptItem } from "@/hooks/useTranscriptFilter";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface HierarchicalSummaryLayersProps {
  transcripts?: TranscriptItem[];
  isLoading?: boolean;
  viewType?: "timeline" | "project" | "group" | "topic";
  projectName?: string;
  onSummaryUpdated?: () => void;
}

export const HierarchicalSummaryLayers = ({ 
  transcripts = [], 
  isLoading,
  viewType,
  projectName,
  onSummaryUpdated 
}: HierarchicalSummaryLayersProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("group");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editedGroupSummaries, setEditedGroupSummaries] = useState<Record<string, string>>({});
  const [deletingPersonalId, setDeletingPersonalId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [projectSummary, setProjectSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingProjectSummary, setIsFetchingProjectSummary] = useState(false);
  const [editingPersonalId, setEditingPersonalId] = useState<string | null>(null);
  const [editedPersonalSummaries, setEditedPersonalSummaries] = useState<Record<string, string>>({});
  const [editedProjectSummary, setEditedProjectSummary] = useState<string | null>(null);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const { toast } = useToast();

  // Get personal summaries (user-adjusted via adjust_summary tool)
  // These come from the personalSummary field in Azure Search
  const personalSummaries = transcripts
    .filter((t) => t.personalSummary)
    .map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.personalSummary,
    }));
  
  // Group summaries are the original default summaries (initial + after corrections)
  // These come from the summaryText field in Azure Search
  const groupSummaries = transcripts
    .filter((t) => t.summaryText)
    .map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summaryText,
    }));

  // Fetch existing project summary from Azure AI Search
  // Refetch when transcripts change (new meeting added) or when project/view changes
  useEffect(() => {
    // Only reset state when project changes, not when transcripts change
    if (!projectName || viewType !== "project") {
      setProjectSummary(null);
      setEditedProjectSummary(null);
      setIsEditingProject(false);
      return;
    }
    
    const fetchExistingProjectSummary = async () => {
      setIsFetchingProjectSummary(true);
      try {
        const { data, error } = await supabase.functions.invoke('transcripts-search', {
          body: {
            query: '*',
            project: projectName,
            top: 10,
          },
        });

        if (error) {
          console.error('Error fetching project summary:', error);
          return;
        }

        const transcriptWithProjectSummary = data?.results?.find(
          (result: any) => result.projectSummary
        );

        if (transcriptWithProjectSummary?.projectSummary) {
          // Only update if the summary actually changed
          if (transcriptWithProjectSummary.projectSummary !== projectSummary) {
            setProjectSummary(transcriptWithProjectSummary.projectSummary);
            console.log('Updated project summary for', projectName);
          }
        } else {
          console.log('No existing project summary found for', projectName);
          setProjectSummary(null);
        }
      } catch (err) {
        console.error('Error fetching project summary:', err);
      } finally {
        setIsFetchingProjectSummary(false);
      }
    };

    fetchExistingProjectSummary();
  }, [projectName, viewType, transcripts.length]);

  const handleGenerateProjectSummary = async () => {
    if (!projectName) {
      toast({
        variant: "destructive",
        title: t('dashboard.cannotGenerate'),
        description: t('dashboard.noProjectSpecified'),
      });
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('transcripts-generate-project-summary', {
        body: {
          project: projectName,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate project summary');
      }

      setProjectSummary(data.projectSummary);
      setEditedProjectSummary(null);
      setIsEditingProject(false);
      setActiveTab("project");
      
      toast({
        title: t('dashboard.projectSummaryGenerated'),
        description: t('dashboard.summaryCreatedFrom', { count: data.meetingCount }),
      });
    } catch (err) {
      console.error('Error generating project summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.generationFailed'),
        description: err instanceof Error ? err.message : 'Failed to generate project summary.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSavePersonalSummary = async (transcriptId: string, newSummary: string) => {
    setIsSaving(true);
    try {
      const { error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId,
          summaryText: newSummary,
        },
      });

      if (error) throw error;

      toast({
        title: t('dashboard.summarySaved'),
        description: t('dashboard.personalSummarySaved'),
      });
      
      setEditingPersonalId(null);
      setEditedPersonalSummaries(prev => {
        const updated = { ...prev };
        delete updated[transcriptId];
        return updated;
      });
      
      onSummaryUpdated?.();
    } catch (err) {
      console.error('Error saving personal summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.saveFailed'),
        description: err instanceof Error ? err.message : 'Failed to save summary.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProjectSummary = async () => {
    if (!projectName || !editedProjectSummary) return;
    
    setIsSaving(true);
    try {
      const { error } = await supabase.functions.invoke('transcripts-generate-project-summary', {
        body: {
          project: projectName,
          projectSummaryOverride: editedProjectSummary,
        },
      });

      if (error) throw error;

      setProjectSummary(editedProjectSummary);
      setEditedProjectSummary(null);
      setIsEditingProject(false);
      
      toast({
        title: t('dashboard.projectSummarySaved'),
        description: `${t('dashboard.projectSummary')} ${projectName}`,
      });
      
      onSummaryUpdated?.();
    } catch (err) {
      console.error('Error saving project summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.saveFailed'),
        description: err instanceof Error ? err.message : 'Failed to save project summary.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProjectMemory = async () => {
    if (!projectName) return;
    
    setIsDeletingProject(true);
    try {
      const { data, error } = await supabase.functions.invoke('transcripts-delete-memory', {
        body: {
          type: 'project',
          project: projectName,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to delete project memory');
      }

      setProjectSummary(null);
      setEditedProjectSummary(null);
      setIsEditingProject(false);
      
      toast({
        title: t('dashboard.projectMemoryDeleted'),
        description: t('dashboard.memoryDeletedFor', { name: projectName }),
      });
      
      onSummaryUpdated?.();
    } catch (err) {
      console.error('Error deleting project memory:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.deleteFailed'),
        description: err instanceof Error ? err.message : 'Failed to delete project memory.',
      });
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleSaveGroupSummary = async (transcriptId: string, newSummary: string) => {
    setIsSaving(true);
    try {
      const { error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId,
          summaryText: newSummary,
        },
      });

      if (error) throw error;

      toast({
        title: t('dashboard.summarySaved'),
        description: t('dashboard.groupSummarySaved'),
      });
      
      setEditingGroupId(null);
      setEditedGroupSummaries(prev => {
        const updated = { ...prev };
        delete updated[transcriptId];
        return updated;
      });
      
      onSummaryUpdated?.();
      
      // Trigger project memory regeneration after group summary update
      if (isProjectView && projectName && !isUnassignedView) {
        // Wait for Azure Search to index the updated summary
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        try {
          const { data, error: projectError } = await supabase.functions.invoke('transcripts-generate-project-summary', {
            body: { project: projectName },
          });
          
          if (!projectError && data?.success) {
            setProjectSummary(data.projectSummary);
            toast({
              title: t('dashboard.projectMemoryUpdated'),
              description: t('dashboard.memoryUpdatedFor', { name: projectName }),
            });
          }
        } catch (projectErr) {
          console.error('Error updating project memory:', projectErr);
        }
      }
    } catch (err) {
      console.error('Error saving group summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.saveFailed'),
        description: err instanceof Error ? err.message : 'Failed to save summary.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePersonalSummary = async (transcriptId: string) => {
    setDeletingPersonalId(transcriptId);
    try {
      const { error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId,
          personalSummary: null, // Clear personal summary
        },
      });

      if (error) throw error;

      toast({
        title: t('dashboard.summaryDeleted'),
        description: t('dashboard.personalSummaryDeleted'),
      });
      
      onSummaryUpdated?.();
    } catch (err) {
      console.error('Error deleting personal summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.deleteFailed'),
        description: err instanceof Error ? err.message : 'Failed to delete personal summary.',
      });
    } finally {
      setDeletingPersonalId(null);
    }
  };

  const handleDeleteGroupSummary = async (transcriptId: string) => {
    setDeletingGroupId(transcriptId);
    try {
      const { error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId,
          summaryText: null, // Clear group summary
        },
      });

      if (error) throw error;

      toast({
        title: t('dashboard.summaryDeleted'),
        description: t('dashboard.groupSummaryDeleted'),
      });
      
      onSummaryUpdated?.();
    } catch (err) {
      console.error('Error deleting group summary:', err);
      toast({
        variant: "destructive",
        title: t('dashboard.deleteFailed'),
        description: err instanceof Error ? err.message : 'Failed to delete group summary.',
      });
    } finally {
      setDeletingGroupId(null);
    }
  };

  const isProjectView = viewType === "project";
  const isUnassignedView = projectName?.toLowerCase() === "unassigned";
  const canGenerateProjectSummary = isProjectView && groupSummaries.length > 0 && !isUnassignedView;
  const hasUnsavedChanges = Object.keys(editedPersonalSummaries).length > 0 || Object.keys(editedGroupSummaries).length > 0 || (isEditingProject && editedProjectSummary !== projectSummary);
  
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t('dashboard.hierarchicalTitle')}</CardTitle>
            <CardDescription>
              {t('dashboard.hierarchicalDescription')}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {canGenerateProjectSummary && activeTab === "project" && (
              <Button 
                variant="default" 
                size="sm"
                onClick={handleGenerateProjectSummary}
                disabled={isGenerating || isFetchingProjectSummary || isLoading}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('dashboard.generating')}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {projectSummary ? t('dashboard.regenerateProjectSummary') : t('dashboard.generateProjectSummary')}
                  </>
                )}
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={() => {
                if (activeTab === "personal" && editingPersonalId && editedPersonalSummaries[editingPersonalId]) {
                  handleSavePersonalSummary(editingPersonalId, editedPersonalSummaries[editingPersonalId]);
                } else if (activeTab === "group" && editingGroupId && editedGroupSummaries[editingGroupId]) {
                  handleSaveGroupSummary(editingGroupId, editedGroupSummaries[editingGroupId]);
                } else if (activeTab === "project" && isEditingProject && editedProjectSummary) {
                  handleSaveProjectSummary();
                }
              }}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('dashboard.saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('dashboard.saveValidation')}
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="group">{t('dashboard.groupSummary')}</TabsTrigger>
            <TabsTrigger value="personal">{t('dashboard.personalSummary')}</TabsTrigger>
            {isProjectView && (
              <TabsTrigger value="project">{t('dashboard.projectSummary')}</TabsTrigger>
            )}
          </TabsList>
          
          <TabsContent value="personal" className="mt-0">
            <ScrollArea className="h-[420px]">
              <div className="space-y-3 pr-4">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">{t('dashboard.loadingSummaries')}</p>
                ) : personalSummaries.length > 0 ? (
                  personalSummaries.map((item) => (
                    <div key={item.id} className="p-3 bg-muted/50 rounded-lg border">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{item.title}</p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => {
                              if (editingPersonalId === item.id) {
                                setEditingPersonalId(null);
                              } else {
                                setEditingPersonalId(item.id);
                                if (!editedPersonalSummaries[item.id]) {
                                  setEditedPersonalSummaries(prev => ({
                                    ...prev,
                                    [item.id]: item.summary || '',
                                  }));
                                }
                              }
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                disabled={deletingPersonalId === item.id}
                              >
                                {deletingPersonalId === item.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('dashboard.deletePersonalSummary')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('dashboard.deletePersonalSummaryDesc', { title: item.title })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeletePersonalSummary(item.id)}>
                                  {t('common.delete')}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      {editingPersonalId === item.id ? (
                        <Textarea
                          value={editedPersonalSummaries[item.id] || item.summary || ''}
                          onChange={(e) => setEditedPersonalSummaries(prev => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))}
                          className="text-sm min-h-[80px]"
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
                          <MarkdownRenderer content={item.summary || ''} />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-muted/50 rounded-lg border">
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.noPersonalSummaries')}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="group" className="mt-0">
            <ScrollArea className="h-[420px]">
              <div className="space-y-3 pr-4">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">{t('dashboard.loadingSummaries')}</p>
                ) : groupSummaries.length > 0 ? (
                  groupSummaries.map((item) => (
                    <div key={item.id} className="p-3 bg-muted/50 rounded-lg border">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{item.title}</p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => {
                              if (editingGroupId === item.id) {
                                setEditingGroupId(null);
                              } else {
                                setEditingGroupId(item.id);
                                if (!editedGroupSummaries[item.id]) {
                                  setEditedGroupSummaries(prev => ({
                                    ...prev,
                                    [item.id]: item.summary || '',
                                  }));
                                }
                              }
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                disabled={deletingGroupId === item.id}
                              >
                                {deletingGroupId === item.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('dashboard.deleteGroupSummary')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('dashboard.deleteGroupSummaryDesc', { title: item.title })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteGroupSummary(item.id)}>
                                  {t('common.delete')}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      {editingGroupId === item.id ? (
                        <Textarea
                          value={editedGroupSummaries[item.id] || item.summary || ''}
                          onChange={(e) => setEditedGroupSummaries(prev => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))}
                          className="text-sm min-h-[80px]"
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
                          <MarkdownRenderer content={item.summary || ''} />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-muted/50 rounded-lg border">
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.noGroupSummaries')}
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
          
          <TabsContent value="project" className="mt-0">
            <div className="p-4 bg-muted/50 rounded-lg border">
              {isUnassignedView ? (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.cannotGenerateUnassigned')}
                </p>
              ) : isFetchingProjectSummary ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <p className="text-sm text-muted-foreground">{t('dashboard.loadingProjectSummary')}</p>
                </div>
              ) : projectSummary ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">
                      {projectName} - {t('dashboard.projectSummary')}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          if (isEditingProject) {
                            setIsEditingProject(false);
                            setEditedProjectSummary(null);
                          } else {
                            setIsEditingProject(true);
                            setEditedProjectSummary(projectSummary);
                          }
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            disabled={isDeletingProject}
                          >
                            {isDeletingProject ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('dashboard.deleteProjectMemory')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('dashboard.deleteProjectMemoryDesc', { name: projectName })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteProjectMemory}>
                              {t('common.delete')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                  {isEditingProject ? (
                    <Textarea
                      value={editedProjectSummary || ''}
                      onChange={(e) => setEditedProjectSummary(e.target.value)}
                      className="text-sm min-h-[120px]"
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
                      <MarkdownRenderer content={projectSummary} />
                    </div>
                  )}
                </div>
              ) : isProjectView ? (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.clickGenerateProject')}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.groupDescription')}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

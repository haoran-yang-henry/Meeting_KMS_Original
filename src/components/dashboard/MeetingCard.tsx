import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, ChevronDown, Pencil, Check, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSidebarCategories } from "@/hooks/useSidebarCategories";

interface MeetingCardProps {
  transcriptId: string;
  letter: string;
  title: string;
  dateTime: string;
  topics: string[];
  keywords: string[];
  project?: string;
  onDelete?: () => void;
  onMetadataChange?: () => void;
}

export const MeetingCard = ({ transcriptId, letter, title, dateTime, topics, keywords, project, onDelete, onMetadataChange }: MeetingCardProps) => {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const { categories, addProject } = useSidebarCategories();
  
  // Editable fields
  const [editingProject, setEditingProject] = useState(false);
  const [projectValue, setProjectValue] = useState(project || '');
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  
  // Sync existing project to sidebar on mount
  useEffect(() => {
    if (project && project.trim() && !categories.projects.includes(project.trim())) {
      addProject(project.trim());
    }
  }, [project, categories.projects, addProject]);

  const handleDelete = async () => {
    setIsDeleting(true);
    
    // Store project before deletion for memory update
    const projectBeforeDelete = project;
    
    try {
      const { data, error } = await supabase.functions.invoke('transcripts-delete', {
        body: { transcriptId }
      });
      
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to delete transcript');
      
      toast({
        title: t('meetingCard.transcriptDeleted'),
        description: t('meetingCard.deletedDocuments', { count: data.deletedCount }),
      });
      
      // First refresh: remove deleted meeting from list
      onDelete?.();
      
      // Auto-update project memory after deletion (if project was assigned)
      if (projectBeforeDelete && projectBeforeDelete.trim() && projectBeforeDelete.toLowerCase() !== 'unassigned') {
        console.log('Auto-updating project memory after deletion for:', projectBeforeDelete);
        // Wait 2 seconds for Azure Search to process the deletion
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const { data: projectData, error: projectError } = await supabase.functions.invoke('transcripts-generate-project-summary', {
            body: { project: projectBeforeDelete },
          });

          if (projectError) {
            console.error('Failed to update project memory after deletion:', projectError);
          } else if (projectData?.success) {
            console.log('Project memory updated after deletion');
            toast({
              title: t('dashboard.projectMemoryUpdated', 'Project memory updated'),
              description: t('dashboard.memoryRefreshedAfterDelete', { name: projectBeforeDelete }),
            });
            // Second refresh: trigger UI to fetch updated project memory
            // Wait a bit for Azure Search to index the new projectSummary
            await new Promise(resolve => setTimeout(resolve, 1000));
            onDelete?.();
          }
        } catch (projectErr) {
          console.error('Error updating project memory after deletion:', projectErr);
        }
      }
    } catch (err) {
      console.error('Failed to delete transcript:', err);
      toast({
        variant: 'destructive',
        title: t('meetingCard.deleteFailed'),
        description: t('meetingCard.couldNotDelete'),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const saveMetadata = async (field: 'project' | 'topic', value: string) => {
    setIsSavingMetadata(true);
    try {
      const body: Record<string, any> = { transcriptId };
      if (field === 'project') {
        body.project = value;
      } else {
        body.topics = value ? [value] : [];
      }
      
      const { data, error } = await supabase.functions.invoke('transcripts-save-summary', {
        body
      });
      
      if (error) throw error;
      
      toast({
        title: t('meetingCard.updated'),
        description: field === 'project' ? t('meetingCard.projectSaved') : t('meetingCard.topicSaved'),
      });
      
      onMetadataChange?.();
    } catch (err) {
      console.error('Failed to save metadata:', err);
      toast({
        variant: 'destructive',
        title: t('dashboard.saveFailed'),
        description: `${t('meetingCard.couldNotUpdate')} ${field === 'project' ? t('meetingCard.project').toLowerCase() : t('meetingCard.topic').toLowerCase()}`,
      });
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const handleSaveProject = async () => {
    await saveMetadata('project', projectValue);
    
    // Check if the project name exists in the projects list, if not add it
    const trimmedProject = projectValue.trim();
    if (trimmedProject && !categories.projects.includes(trimmedProject)) {
      addProject(trimmedProject);
    }
    
    setEditingProject(false);
  };


  const handleCancelProject = () => {
    setProjectValue(project || '');
    setEditingProject(false);
  };
  
  // Filter out status: prefixed tags from keywords
  const displayKeywords = keywords.filter(k => !k.startsWith('status:'));
  
  return (
    <div className="border rounded-lg p-4 bg-card hover:shadow-md transition-shadow w-[280px] flex-shrink-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0">
            {letter}
          </div>
          <span className="font-medium text-foreground truncate">{title}</span>
        </div>
        
        <div className="flex items-center gap-1">
          {/* Delete button */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('meetingCard.deleteMeeting')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('meetingCard.deleteConfirm')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? t('meetingCard.deleting') : t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      
      <p className="text-sm text-muted-foreground mb-3">{dateTime}</p>
      
      {/* Project field - editable */}
      <div className="mb-2">
        <p className="text-xs text-muted-foreground mb-1">{t('meetingCard.project')}</p>
        {editingProject ? (
          <div className="flex items-center gap-1">
            <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
              <PopoverTrigger asChild>
                <div className="relative flex-1">
                  <Input
                    value={projectValue}
                    onChange={(e) => setProjectValue(e.target.value)}
                    placeholder={t('meetingCard.enterProject')}
                    className="h-7 text-xs pr-6"
                    disabled={isSavingMetadata}
                  />
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-[180px] p-1 bg-popover z-50" align="start">
                <div className="max-h-[150px] overflow-y-auto">
                  {categories.projects.length > 0 ? (
                    categories.projects.map((p) => (
                      <button
                        key={p}
                        className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent"
                        onClick={() => {
                          setProjectValue(p);
                          setProjectPopoverOpen(false);
                        }}
                      >
                        {p}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('meetingCard.noProjects')}</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSaveProject} disabled={isSavingMetadata}>
              <Check className="h-3 w-3 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancelProject} disabled={isSavingMetadata}>
              <X className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <div 
            className="flex items-center gap-1 cursor-pointer group"
            onClick={() => setEditingProject(true)}
          >
            <span className="text-xs text-foreground">
              {projectValue || <span className="text-muted-foreground italic">{t('meetingCard.notSet')}</span>}
            </span>
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
      
      
      {displayKeywords.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">{t('meetingCard.aiKeywords')}</p>
          <p className="text-xs text-foreground">{displayKeywords.join(" · ")}</p>
        </div>
      )}
    </div>
  );
};

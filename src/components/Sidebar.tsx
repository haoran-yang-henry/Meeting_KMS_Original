import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, FolderOpen, Edit2, Check, X, Inbox, Trash2 } from "lucide-react";
import { useSidebarCategories } from "@/hooks/useSidebarCategories";
import { Skeleton } from "@/components/ui/skeleton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
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

export const Sidebar = () => {
  const { categories, isLoading, addProject, renameProject, deleteProject } = useSidebarCategories();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  
  // Edit state
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editProjectName, setEditProjectName] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Delete state
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Use URL-safe encoding for filter values (preserves original casing)
  const toUrlPath = (value: string) => encodeURIComponent(value);

  const handleAddProject = () => {
    if (newProjectName.trim()) {
      addProject(newProjectName.trim());
      setNewProjectName("");
      setIsAddingProject(false);
    }
  };

  const handleCancelAdd = () => {
    setNewProjectName("");
    setIsAddingProject(false);
  };

  const handleStartEdit = (project: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingProject(project);
    setEditProjectName(project);
  };

  const handleSaveEdit = async () => {
    if (!editingProject || !editProjectName.trim()) return;
    
    setIsUpdating(true);
    const success = await renameProject(editingProject, editProjectName.trim());
    setIsUpdating(false);
    
    if (success) {
      toast.success(t('sidebar.projectRenamed') || 'Project renamed successfully');
      // If we're currently viewing this project, navigate to the new name
      const currentPath = decodeURIComponent(location.pathname);
      if (currentPath === `/project/${editingProject}`) {
        navigate(`/project/${toUrlPath(editProjectName.trim())}`);
      }
      setEditingProject(null);
      setEditProjectName("");
    } else {
      toast.error(t('sidebar.projectRenameError') || 'Failed to rename project');
    }
  };

  const handleCancelEdit = () => {
    setEditingProject(null);
    setEditProjectName("");
  };

  const handleDeleteClick = (project: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    
    setIsDeleting(true);
    const success = await deleteProject(projectToDelete);
    setIsDeleting(false);
    
    if (success) {
      toast.success(t('sidebar.projectDeleted') || 'Project deleted. Meetings moved to Unassigned.');
      // If we're currently viewing this project, navigate to unassigned
      const currentPath = decodeURIComponent(location.pathname);
      if (currentPath === `/project/${projectToDelete}`) {
        navigate('/project/unassigned');
      }
      setProjectToDelete(null);
    } else {
      toast.error(t('sidebar.projectDeleteError') || 'Failed to delete project');
    }
  };

  return (
    <>
      <aside className="w-64 border-r bg-card h-screen flex flex-col">
        <div className="p-6 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Browse</h2>
          <LanguageToggle />
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {/* Quick Actions */}
            <div className="space-y-1">
              <NavLink
                to="/"
                className="flex items-center px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                activeClassName="bg-sidebar-active text-primary"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('sidebar.add')}
              </NavLink>
              <NavLink
                to="/search"
                className="flex items-center px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                activeClassName="bg-sidebar-active text-primary"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                {t('sidebar.search')}
              </NavLink>
            </div>

            {/* Timeline Section */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                Timeline
              </h3>
              <NavLink
                to="/today"
                className="block px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                activeClassName="bg-sidebar-active text-primary"
              >
                {t('sidebar.today')}
              </NavLink>
              <NavLink
                to="/week"
                className="block px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                activeClassName="bg-sidebar-active text-primary"
              >
                {t('sidebar.thisWeek')}
              </NavLink>
              <NavLink
                to="/month"
                className="block px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                activeClassName="bg-sidebar-active text-primary"
              >
                {t('sidebar.thisMonth')}
              </NavLink>
            </div>

            {/* Project Section - Dynamic from Azure AI Search */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('sidebar.projects')}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => setIsAddingProject(true)}
                  title={t('sidebar.addProject')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Add new project input */}
              {isAddingProject && (
                <div className="flex items-center gap-1 px-2">
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder={t('sidebar.newProjectPlaceholder')}
                    className="h-7 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddProject();
                      if (e.key === 'Escape') handleCancelAdd();
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={handleAddProject}
                  >
                    <Check className="h-3.5 w-3.5 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={handleCancelAdd}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              )}

              {isLoading ? (
                <div className="space-y-2 px-2">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-6 w-20" />
                </div>
              ) : (
                <>
                  {/* Unassigned Meetings - always show first */}
                  <NavLink
                    to="/project/unassigned"
                    className="flex items-center px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors"
                    activeClassName="bg-sidebar-active text-primary"
                  >
                    <Inbox className="mr-2 h-4 w-4 text-muted-foreground" />
                    {t('sidebar.unassigned')}
                  </NavLink>

                  {categories.projects.length > 0 ? (
                    categories.projects.map((project) => (
                      editingProject === project ? (
                        // Edit mode
                        <div key={project} className="flex items-center gap-1 px-2">
                          <Input
                            value={editProjectName}
                            onChange={(e) => setEditProjectName(e.target.value)}
                            className="h-7 text-sm flex-1"
                            autoFocus
                            disabled={isUpdating}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={handleSaveEdit}
                            disabled={isUpdating}
                          >
                            <Check className="h-3.5 w-3.5 text-primary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={handleCancelEdit}
                            disabled={isUpdating}
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        // View mode
                        <NavLink
                          key={project}
                          to={`/project/${toUrlPath(project)}`}
                          className="flex items-center px-2 py-1.5 text-sm rounded-md hover:bg-sidebar-hover transition-colors group"
                          activeClassName="bg-sidebar-active text-primary"
                        >
                          <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span className="flex-1 truncate">{project}</span>
                          <div className="hidden group-hover:flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={(e) => handleStartEdit(project, e)}
                              title={t('sidebar.editProject') || 'Edit project'}
                            >
                              <Edit2 className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={(e) => handleDeleteClick(project, e)}
                              title={t('sidebar.deleteProject') || 'Delete project'}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </div>
                        </NavLink>
                      )
                    ))
                  ) : (
                    <p className="px-2 text-xs text-muted-foreground">{t('sidebar.noProjectsYet')}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteProjectTitle') || 'Delete Project'}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteProjectDescription') || `Are you sure you want to delete "${projectToDelete}"? All meetings in this project will be moved to Unassigned.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('common.cancel') || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (t('common.deleting') || 'Deleting...') : (t('common.delete') || 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

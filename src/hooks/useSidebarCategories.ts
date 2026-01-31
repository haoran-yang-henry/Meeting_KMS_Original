import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SidebarCategories {
  projects: string[];
}

const LOCAL_PROJECTS_KEY = "sidebar-local-projects";
const PROJECTS_CHANGED_EVENT = "sidebar-projects-changed";

// Load locally added projects
const loadLocalProjects = (): string[] => {
  try {
    const stored = localStorage.getItem(LOCAL_PROJECTS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

// Save locally added projects
const saveLocalProjects = (projects: string[]) => {
  try {
    localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects));
  } catch (err) {
    console.error("Failed to save local projects:", err);
  }
};

const emitProjectsChanged = () => {
  try {
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  } catch {
    // no-op
  }
};

export const useSidebarCategories = () => {
  // Initialize from localStorage for instant render (no flash)
  const [categories, setCategories] = useState<SidebarCategories>(() => ({
    projects: loadLocalProjects(),
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchCategories = useCallback(async () => {
    // Only show loading on first fetch, not on refetch
    if (!hasFetched) setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("transcripts-search", {
        body: {
          query: "*",
          // fetch more so project inventory is less likely to be truncated
          top: 1000,
        },
      });

      if (error) {
        console.error("Error fetching categories:", error);
        return;
      }

      const results = data?.results || [];

      // Extract unique project values
      const projectsSet = new Set<string>();

      results.forEach((item: any) => {
        const p = typeof item?.project === "string" ? item.project.trim() : "";
        if (p && p.toLowerCase() !== "unassigned") {
          projectsSet.add(p);
        }
      });

      // Merge with local projects from storage (source of truth across components)
      const localProjects = loadLocalProjects();
      localProjects.forEach((p) => {
        const trimmed = String(p).trim();
        if (trimmed && trimmed.toLowerCase() !== "unassigned") projectsSet.add(trimmed);
      });

      setCategories({
        projects: Array.from(projectsSet).sort(),
      });
    } catch (err) {
      console.error("Error fetching sidebar categories:", err);
    } finally {
      setIsLoading(false);
      setHasFetched(true);
    }
  }, [hasFetched]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Add a new project locally
  const addProject = useCallback((projectName: string) => {
    const trimmed = projectName.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === "unassigned") return;

    const current = loadLocalProjects();
    if (!current.includes(trimmed)) {
      const updated = [...current, trimmed];
      saveLocalProjects(updated);
    }

    // Update current hook instance immediately
    setCategories((prev) => {
      if (prev.projects.includes(trimmed)) return prev;
      return {
        ...prev,
        projects: [...prev.projects, trimmed].sort(),
      };
    });

    // Notify other hook instances (e.g., Sidebar) to refetch
    emitProjectsChanged();
  }, []);

  // Rename a project - updates all meetings and local storage
  const renameProject = useCallback(async (oldName: string, newName: string): Promise<boolean> => {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    
    if (!trimmedOld || !trimmedNew) return false;
    if (trimmedNew.toLowerCase() === "unassigned") return false;
    if (trimmedOld === trimmedNew) return true;

    try {
      // Call edge function to update all meetings with this project
      const { error } = await supabase.functions.invoke("transcripts-update-project", {
        body: {
          oldProjectName: trimmedOld,
          newProjectName: trimmedNew,
        },
      });

      if (error) {
        console.error("Error renaming project:", error);
        return false;
      }

      // Update local storage
      const current = loadLocalProjects();
      const updated = current
        .filter((p) => p !== trimmedOld)
        .concat(trimmedNew);
      saveLocalProjects(updated);

      // Update current hook instance immediately
      setCategories((prev) => {
        const filtered = prev.projects.filter((p) => p !== trimmedOld);
        if (!filtered.includes(trimmedNew)) {
          filtered.push(trimmedNew);
        }
        return {
          ...prev,
          projects: filtered.sort(),
        };
      });

      // Notify other hook instances
      emitProjectsChanged();
      return true;
    } catch (err) {
      console.error("Error renaming project:", err);
      return false;
    }
  }, []);

  // Delete a project - sets all meetings to unassigned
  const deleteProject = useCallback(async (projectName: string): Promise<boolean> => {
    const trimmed = projectName.trim();
    if (!trimmed) return false;

    try {
      // Call edge function to unassign all meetings from this project
      const { error } = await supabase.functions.invoke("transcripts-update-project", {
        body: {
          oldProjectName: trimmed,
          // No newProjectName means delete (set to unassigned)
        },
      });

      if (error) {
        console.error("Error deleting project:", error);
        return false;
      }

      // Update local storage
      const current = loadLocalProjects();
      const updated = current.filter((p) => p !== trimmed);
      saveLocalProjects(updated);

      // Update current hook instance immediately
      setCategories((prev) => ({
        ...prev,
        projects: prev.projects.filter((p) => p !== trimmed),
      }));

      // Notify other hook instances
      emitProjectsChanged();
      return true;
    } catch (err) {
      console.error("Error deleting project:", err);
      return false;
    }
  }, []);

  // Refresh categories (e.g., after saving a transcript with a new project)
  // Don't show loading on refresh to avoid UI flicker
  const refreshCategories = useCallback(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Keep multiple hook instances in sync (MeetingCard <-> Sidebar)
  useEffect(() => {
    const handler = () => refreshCategories();
    window.addEventListener(PROJECTS_CHANGED_EVENT, handler);

    // Also support multi-tab changes
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_PROJECTS_KEY) refreshCategories();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, handler);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshCategories]);

  return { categories, isLoading, addProject, renameProject, deleteProject, refreshCategories };
};
